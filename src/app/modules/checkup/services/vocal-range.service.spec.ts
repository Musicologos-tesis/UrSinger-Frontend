import { TestBed } from '@angular/core/testing';
import { VocalRangeService } from './vocal-range.service';

describe('VocalRangeService', () => {
  let service: VocalRangeService;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    service = TestBed.inject(VocalRangeService);
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });
});
