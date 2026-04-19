import { Component, Input, OnDestroy, OnInit } from '@angular/core';

export type FlashcardTone = 'error' | 'warning' | 'info' | 'success';

@Component({
  selector: 'app-flashcard',
  standalone: true,
  templateUrl: './flashcard.component.html',
  styleUrl: './flashcard.component.scss',
})
export class FlashcardComponent implements OnInit, OnDestroy {
  @Input() tone: FlashcardTone = 'info';
  @Input() title = '';
  @Input() message = '';
  @Input() floating = false;
  @Input() autoMinimizeMs = 4500;

  minimized = false;
  private timerId: ReturnType<typeof setTimeout> | null = null;

  get icon(): string {
    switch (this.tone) {
      case 'error':
        return '⚠️';
      case 'warning':
        return '⚠️';
      case 'success':
        return '✅';
      default:
        return 'ℹ️';
    }
  }

  ngOnInit(): void {
    this.startAutoMinimize();
  }

  ngOnDestroy(): void {
    this.clearTimer();
  }

  toggleMinimized(event?: Event): void {
    event?.stopPropagation();
    this.minimized = !this.minimized;

    if (!this.minimized) {
      this.startAutoMinimize();
    }
  }

  private startAutoMinimize(): void {
    this.clearTimer();

    if (!this.floating || this.autoMinimizeMs <= 0) {
      return;
    }

    this.timerId = setTimeout(() => {
      this.minimized = true;
    }, this.autoMinimizeMs);
  }

  private clearTimer(): void {
    if (this.timerId) {
      clearTimeout(this.timerId);
      this.timerId = null;
    }
  }
}
