// The command palette's filter: every word typed must appear in the command's label or its group. The order of the
// list never changes, so a command stays where the eye learned it.
export type Command = { id: string; label: string; group: string; run: () => void; disabled?: boolean };

export function filterCommands<T extends Pick<Command, 'label' | 'group' | 'disabled'>>(commands: readonly T[], query: string): T[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  return commands.filter(command => !command.disabled && words.every(word => `${command.group} ${command.label}`.toLowerCase().includes(word)));
}
// Ctrl+K everywhere, Cmd+K on a Mac.
export const isPaletteShortcut = (event: Pick<KeyboardEvent, 'key' | 'ctrlKey' | 'metaKey' | 'altKey' | 'shiftKey'>) => event.key.toLowerCase() === 'k' && (event.ctrlKey || event.metaKey) && !event.altKey && !event.shiftKey;
