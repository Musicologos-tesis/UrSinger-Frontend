import { ComponentFixture, TestBed } from '@angular/core/testing';
import { VocalRangeComponent } from './vocal-range';

describe('VocalRangeComponent', () => {
  let component: VocalRangeComponent;
  let fixture: ComponentFixture<VocalRangeComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [VocalRangeComponent]
    })
    .compileComponents();

    fixture = TestBed.createComponent(VocalRangeComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
