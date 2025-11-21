import { Component, Input, Output, EventEmitter } from '@angular/core';
import { CommonModule } from '@angular/common';

@Component({
  selector: 'app-auth-header',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './auth-header.component.html',
  styleUrls: ['./auth-header.component.scss']
})
export class AuthHeaderComponent {
  @Input() pageTitle: string = '';
  @Input() showNavigation: boolean = false;
  @Input() activeNav: 'training' | 'checkup' | 'profile' | null = null;
  
  @Output() navTraining = new EventEmitter<void>();
  @Output() navCheckup = new EventEmitter<void>();
  @Output() navProfile = new EventEmitter<void>();
  @Output() navLogout = new EventEmitter<void>();
}
