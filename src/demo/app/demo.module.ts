import { NgModule } from '@angular/core';
import { BrowserAnimationsModule } from '@angular/platform-browser/animations';
import { BrowserModule } from '@angular/platform-browser';
import { FlexLayoutModule } from '@angular/flex-layout';
import { FormsModule } from '@angular/forms';
import { HttpModule } from '@angular/http';
import {
  MatButtonModule, MatCardModule, MatCheckboxModule, MatIconModule, MatMenuModule,
  MatSelectModule, MatToolbarModule, MATERIAL_COMPATIBILITY_MODE
} from '@angular/material';
import { RouterModule } from '@angular/router';

import { JsonSchemaFormModule } from '../../lib/src/json-schema-form.module';
// To include JsonSchemaFormModule after downloading from NPM, use this instead:
// import { JsonSchemaFormModule } from 'angular2-json-schema-form';

import { AceEditorDirective } from './ace-editor.directive';
import { DemoComponent } from './demo.component';
import { DemoRootComponent } from './demo-root.component';

import { routes } from './demo.routes';

@NgModule({
  declarations: [ AceEditorDirective, DemoComponent, DemoRootComponent ],
  imports: [
    BrowserModule, BrowserAnimationsModule, FlexLayoutModule, FormsModule,
    HttpModule, MatButtonModule, MatCardModule, MatCheckboxModule, MatIconModule,
    MatMenuModule, MatSelectModule, MatToolbarModule, RouterModule.forRoot(routes),
    JsonSchemaFormModule
  ],
  providers: [ { provide: MATERIAL_COMPATIBILITY_MODE, useValue: true } ],
  bootstrap: [ DemoRootComponent ]
})
export class DemoModule { }
