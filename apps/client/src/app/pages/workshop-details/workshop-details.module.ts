import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';
import { WorkshopDetailsComponent } from './workshop-details/workshop-details.component';
import { TranslateModule } from '@ngx-translate/core';
import { RouterModule, Routes } from '@angular/router';
import { PermissionsModule } from '../../modules/permissions/permissions.module';
import { ListModule } from '../../modules/list/list.module';
import { WorkshopModule } from '../../modules/workshop/workshop.module';

import { FullpageMessageModule } from '../../modules/fullpage-message/fullpage-message.module';
import { CoreModule } from '../../core/core.module';
import { FlexLayoutModule } from '@angular/flex-layout';
import { FavoritesModule } from '../../modules/favorites/favorites.module';
import { MaintenanceGuard } from '../maintenance/maintenance.guard';
import { VersionLockGuard } from '../version-lock/version-lock.guard';

import { NzAvatarModule } from 'ng-zorro-antd/avatar';

const routes: Routes = [
  {
    path: ':id',
    component: WorkshopDetailsComponent,
    canActivate: [MaintenanceGuard, VersionLockGuard],
    data: {
      title: 'TITLE.Workshop',
    }
  }
];

@NgModule({
    imports: [
    CommonModule,
    TranslateModule,
    CoreModule,
    FlexLayoutModule,
    FavoritesModule,
    RouterModule.forChild(routes),
    WorkshopModule,
    ListModule,
    PermissionsModule,
    FullpageMessageModule,
    NzAvatarModule,
    WorkshopDetailsComponent
]
})
export class WorkshopDetailsModule {
}
