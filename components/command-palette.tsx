'use client';
// Ctrl+K: every existing action by name, from the keyboard. It adds no action of its own; each entry calls the same
// handler as its button, confirmations included.
import { useEffect, useState } from 'react';
import { Search } from 'lucide-react';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from './ui/dialog';
import { filterCommands, isPaletteShortcut, type Command } from '../lib/command-search';

export function CommandPalette({ commands, open, onOpenChange }: { commands: readonly Command[]; open: boolean; onOpenChange: (open: boolean) => void }) {
  const [query, setQuery] = useState(''); const [active, setActive] = useState(0);
  const shown = filterCommands(commands, query);
  const current = shown[Math.min(active, shown.length - 1)];
  useEffect(() => {
    const listen = (event: KeyboardEvent) => { if (isPaletteShortcut(event)) { event.preventDefault(); onOpenChange(true); } };
    window.addEventListener('keydown', listen); return () => window.removeEventListener('keydown', listen);
  }, [onOpenChange]);
  function close(next: boolean) { if (!next) { setQuery(''); setActive(0); } onOpenChange(next); }
  function run(command: Command | undefined) { if (!command) return; close(false); command.run(); }
  return <Dialog open={open} onOpenChange={close}><DialogContent className="command-palette" showCloseButton={false}>
    <DialogTitle className="sr-only">Commands</DialogTitle><DialogDescription className="sr-only">Type to filter, arrows to choose, Enter to run.</DialogDescription>
    <label className="command-input"><Search size={16} aria-hidden="true" /><input autoFocus value={query} placeholder="Type a command or an agent name…" aria-label="Command" role="combobox" aria-expanded="true" aria-controls="command-list" aria-activedescendant={current ? `command-${current.id}` : undefined}
      onChange={event => { setQuery(event.target.value); setActive(0); }}
      onKeyDown={event => {
        if (event.key === 'ArrowDown') { event.preventDefault(); setActive(Math.min(active + 1, shown.length - 1)); }
        else if (event.key === 'ArrowUp') { event.preventDefault(); setActive(Math.max(active - 1, 0)); }
        else if (event.key === 'Enter') { event.preventDefault(); run(current); }
      }} /></label>
    <ul id="command-list" role="listbox" aria-label="Commands" className="command-list">
      {shown.map(command => <li key={command.id} id={`command-${command.id}`} role="option" aria-selected={command === current} onMouseDown={event => event.preventDefault()} onClick={() => run(command)}><span>{command.label}</span><small>{command.group}</small></li>)}
      {!shown.length && <li className="helper" role="presentation">No command matches.</li>}
    </ul>
  </DialogContent></Dialog>;
}
