import { describe, expect, it } from 'vitest';
import {
  calculateProjectProgress,
  DEFAULT_ROBLOX_STAGES,
  renderProgressBar,
} from '../src/domain/roadmap.js';

describe('Roadmap Progress Calculations', () => {
  it('contains 12 default editable Roblox game development stages', () => {
    expect(DEFAULT_ROBLOX_STAGES).toHaveLength(12);
    expect(DEFAULT_ROBLOX_STAGES[0].title).toBe('Game Concept & Planning');
    expect(DEFAULT_ROBLOX_STAGES[11].title).toBe('Final Release');
  });

  it('calculates dynamic overall project progress and identifies current focus milestone', () => {
    const summary = calculateProjectProgress([
      { id: 1, title: 'Stage 1', status: 'Completed', progressPercent: 20, sortOrder: 1 },
      { id: 2, title: 'Stage 2', status: 'In Progress', progressPercent: 60, sortOrder: 2 },
      { id: 3, title: 'Stage 3', status: 'Blocked', progressPercent: 20, sortOrder: 3 },
      { id: 4, title: 'Stage 4', status: 'Not Started', progressPercent: 0, sortOrder: 4 },
    ]);

    // Completed counts as 100 regardless of stored field: (100 + 60 + 20 + 0) / 4 = 45
    expect(summary.overallPercent).toBe(45);
    expect(summary.completedCount).toBe(1);
    expect(summary.inProgressCount).toBe(1);
    expect(summary.blockedCount).toBe(1);
    expect(summary.notStartedCount).toBe(1);
    expect(summary.currentMilestone?.id).toBe(2);
  });

  it('renders bounded visual progress bar', () => {
    expect(renderProgressBar(50, 10)).toBe('█████░░░░░ 50%');
    expect(renderProgressBar(150, 10)).toBe('██████████ 100%');
    expect(renderProgressBar(-10, 10)).toBe('░░░░░░░░░░ 0%');
  });
});
