import { useEffect, useRef, useState } from 'react';
import { useLock } from '../ui';
import Board, { type BoardApi } from '../Board';
import { clearBoard, newDoc, openLocalBoard, undo, useUndoState } from '../store';
import { seedBoard } from '../seed';
import { linkProps } from '../router';
import { auth } from '../api';
import Icon, { Mark } from '../icons';
import { Popover, ThemeSwitch } from '../ui';
import { ExportSheet } from '../ExportSheet';

/** A board that lives only on this device, for trying Tessel without an account. */
export default function TryPage() {
  const [loaded, setLoaded] = useState(false);
  const [key, setKey] = useState(0);
  const [menu, setMenu] = useState(false);
  const [exporting, setExporting] = useState(false);
  const api = useRef<BoardApi | null>(null);
  useLock();
  const { canUndo, canRedo } = useUndoState(key);
  useEffect(() => {
    newDoc(); setLoaded(false);
    const p = openLocalBoard('demo', (empty) => { if (empty) seedBoard(window.innerWidth < 700); setLoaded(true); });
    setKey((k) => k + 1);
    document.title = 'Try Tessel';
    return () => { p?.destroy(); };
  }, []);
  const top = (
    <>
      <div className="pill brand">
        <a className="logo" {...linkProps('/')} aria-label="Tessel home"><Mark size={24} /></a>
        <span className="title static">Practice board</span>
        <span className="sep" />
        <button className="ib" onClick={() => undo.undo()} disabled={!canUndo} aria-label="Undo"><Icon n="undo" size={20} /></button>
        <button className={'ib' + (canRedo ? '' : ' desk')} onClick={() => undo.redo()} disabled={!canRedo} aria-label="Redo"><Icon n="redo" size={20} /></button>
      </div>
      <div className="pill people">
        <a className="share" {...linkProps(auth.signedIn() ? '/boards' : '/signup')}><span className="always">{auth.signedIn() ? 'My boards' : 'Save & share'}</span></a>
        <div className="rel">
          <button className="ib" data-pop-trigger aria-label="Board menu" onClick={() => setMenu((m) => !m)}><Icon n="more" size={20} /></button>
          <Popover open={menu} onClose={() => setMenu(false)}>
            <p className="muted pad small">This board is saved on this device only. Create a free account to share boards and work together live.</p>
            <button onClick={() => { api.current?.fit(true); setMenu(false); }}><Icon n="fit" size={18} />Fit board to screen</button>
            <button onClick={() => { setMenu(false); setExporting(true); }}><Icon n="download" size={18} />Export as PNG or PDF</button>
            <ThemeSwitch />
            <button onClick={() => { clearBoard(); seedBoard(window.innerWidth < 700); setMenu(false); requestAnimationFrame(() => api.current?.fit(true)); }}><Icon n="reset" size={18} />Restore the sample board</button>
            <button className="danger" onClick={() => { clearBoard(); setMenu(false); api.current?.say('Board cleared. Undo brings it back.'); }}><Icon n="trash" size={18} />Clear the board</button>
          </Popover>
        </div>
      </div>
    </>
  );
  return <div className="board-page"><Board loaded={loaded} top={top} onApi={(a) => { api.current = a; }} />{exporting && <ExportSheet title="Practice board" selection={api.current?.selection() ?? []} onClose={() => setExporting(false)} onDone={(m) => api.current?.say(m)} />}</div>;
}
