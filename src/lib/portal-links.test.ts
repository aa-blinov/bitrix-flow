import { describe, expect, it } from 'vitest';
import { internalHref, setOwnPortal } from './portal-links';

describe('internalHref', () => {
  it('turns portal task links into BitrixFlow task links', () => {
    expect(
      internalHref('https://eora.bitrix24.ru/company/personal/user/9/tasks/task/view/4521/'),
    ).toBe('/all-tasks?task=4521');
    expect(internalHref('https://eora.bitrix24.ru/workgroups/group/10/tasks/task/view/77/')).toBe(
      '/all-tasks?task=77',
    );
  });

  it('turns portal group links into projects', () => {
    expect(internalHref('https://eora.bitrix24.ru/workgroups/group/10/')).toBe('/projects/10');
  });

  it('leaves other hosts and other portal pages alone', () => {
    expect(internalHref('https://example.com/tasks/task/view/5/')).toBeNull();
    expect(internalHref('https://eora.bitrix24.ru/company/personal/user/9/')).toBeNull();
    expect(internalHref('javascript:alert(1)')).toBeNull();
  });

  it('once the own portal is known, a task link of another portal stays external', () => {
    setOwnPortal('eora.bitrix24.ru');
    expect(
      internalHref('https://other.bitrix24.ru/company/personal/user/1/tasks/task/view/5/'),
    ).toBeNull();
    expect(internalHref('https://EORA.bitrix24.ru/workgroups/group/10/')).toBe('/projects/10');
    setOwnPortal('');
  });
});
