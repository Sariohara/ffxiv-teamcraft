import { Inject, Injectable } from '@angular/core';
import { BehaviorSubject, merge, Observable, ReplaySubject, Subject } from 'rxjs';
import { PLAYER_METRICS_PROBES, PlayerMetricProbe } from './probes/player-metric-probe';
import { filter, takeUntil } from 'rxjs/operators';
import { ProbeReport } from './model/probe-report';
import { IpcService } from '../../core/electron/ipc.service';
import { SettingsService } from '../settings/settings.service';
import { MetricType } from './model/metric-type';
import { AuthFacade } from '../../+state/auth.facade';
import { ProbeSource } from './model/probe-source';
import { LogTracking } from '../../model/user/log-tracking';
import { LazyDataService } from '../../core/data/lazy-data.service';

@Injectable({
  providedIn: 'root'
})
export class PlayerMetricsService {

  private stop$ = new Subject<void>();

  private _logs$: Subject<ProbeReport[]> = new ReplaySubject<ProbeReport[]>();

  public readonly logs$: Observable<ProbeReport[]> = this._logs$.asObservable();

  public loading$ = new BehaviorSubject<boolean>(false);

  private buffer: ProbeReport[] = [];

  private started = false;

  private _events$: ReplaySubject<ProbeReport> = new ReplaySubject<ProbeReport>();

  public events$: Observable<ProbeReport> = this._events$.asObservable();

  constructor(private ipc: IpcService, @Inject(PLAYER_METRICS_PROBES) private probes: PlayerMetricProbe[],
              private settings: SettingsService, private authFacade: AuthFacade) {
    setInterval(() => {
      this.saveLogs();
    }, 60000);
    this.ipc.on('metrics:loaded', (e, files: string[]) => {
      const logs = [].concat.apply([], files.map(data => {
        return data.split('|')
          .map(row => {
            const parsed = row.split(';');
            return {
              timestamp: +parsed[0],
              type: +parsed[1],
              data: parsed[2].split(',').map(n => +n)
            };
          });
      }));
      this._logs$.next(logs);
      this.loading$.next(false);
    });
  }

  public start(): void {
    if (this.started) {
      return;
    }
    merge(...this.probes.map(probe => probe.getReports()))
      .pipe(
        takeUntil(this.stop$)
      )
      .subscribe(report => {
        this.handleReport(report);
      });

    // Auto fill log completion on item crafted or gathered.
    this.events$
      .pipe(
        filter(event => {
          return event.type === MetricType.ITEM && event.data[1] > 0;
        })
      )
      .subscribe(event => {
        // If user disabled automated log completion, skip this
        if (!this.settings.pcapLogEnabled) {
          return;
        }
        const source = event.data[2] as ProbeSource;
        const logName = this.getLogName(source);
        if (logName === null) {
          return;
        }
        let id = event.data[0];
        // If it's a crafting event, get the recipe id instead
        if (logName === 'crafting') {
          id = event.data[3];
        }
        this.authFacade.markAsDoneInLog(logName, id, true);
      });

    this.started = true;
  }

  public getLogName(source: ProbeSource): keyof LogTracking {
    switch (source) {
      case ProbeSource.CRAFTING:
        return 'crafting';
      case ProbeSource.FISHING:
      case ProbeSource.GATHERING:
        return 'gathering';
      default:
        return null;
    }
  }

  public stop(): void {
    this.stop$.next();
    this.started = false;
  }

  public load(from: Date, to: Date = new Date()): void {
    this.ipc.send('metrics:load', { from: this.dateToFileName(from), to: this.dateToFileName(to) });
    this.loading$.next(true);
  }

  private dateToFileName(date: Date): string {
    let month = date.getMonth().toString();
    if (+month < 10) {
      month = `0${month}`;
    }
    let day = date.getUTCDate().toString();
    if (+day < 10) {
      day = `0${day}`;
    }
    return `${date.getFullYear()}${month}${day}`;
  }

  private handleReport(report: ProbeReport): void {
    report.timestamp = Math.floor(Date.now() / 1000);
    // If metrics aren't enabled, we don't save anything, not even in memory.
    if (this.settings.playerMetricsEnabled) {
      this.buffer.push(report);
    }
    this._events$.next(report);
  }

  private saveLogs(): void {
    // If metrics aren't enabled, we don't save anything.
    if (!this.settings.playerMetricsEnabled) {
      return;
    }
    // prepare a clone to work on, so we don't overwrite data registered while saving.
    const logs = [...this.buffer];
    this.buffer = [];
    const dataString = logs.map(row => `${row.timestamp};${row.type};${row.data.join(',')}`).join('|');
    this.ipc.send('metrics:persist', dataString);
  }
}
