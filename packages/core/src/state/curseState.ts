/** Whether a curse state is attached by donning the cursed item. */
export function isDonCurseStateOnset(onset: string): boolean {
  return onset === 'don the armor' || onset.startsWith('don ');
}
