import Editor, { type OnMount } from '@monaco-editor/react';
import { useEffect, useRef } from 'react';
import '../lib/monaco';
import type * as Monaco from 'monaco-editor';
import { useStore } from '../lib/store';

const LANG_MAP: Record<string, string> = {
  javascript: 'javascript', typescript: 'typescript', python: 'python', java: 'java', cpp: 'cpp',
  json: 'json', text: 'plaintext', markdown: 'markdown', yaml: 'yaml', sql: 'sql',
};

export function langForPath(path: string, fallback: string) {
  if (/\.tsx?$/.test(path)) return 'typescript';
  if (/\.(m|c)?jsx?$/.test(path)) return 'javascript';
  if (path.endsWith('.py')) return 'python';
  if (path.endsWith('.java')) return 'java';
  if (/\.(cpp|cc|hpp|h)$/.test(path)) return 'cpp';
  if (path.endsWith('.json')) return 'json';
  if (path.endsWith('.md')) return 'markdown';
  if (/\.ya?ml$/.test(path)) return 'yaml';
  if (path.endsWith('.sql')) return 'sql';
  if (/\.(csv|log|txt)$/.test(path)) return 'plaintext';
  return LANG_MAP[fallback] ?? 'plaintext';
}

interface Props {
  path: string;
  value: string;
  language: string;
  readOnly: boolean;
  onChange?: (v: string) => void;
  /** Click-to-select line mode (find-bug stages). */
  onLineClick?: (line: number) => void;
  selectedLines?: number[];
  correctLines?: number[];
}

export default function CodeEditor({ path, value, language, readOnly, onChange, onLineClick, selectedLines, correctLines }: Props) {
  const theme = useStore((s) => s.settings.theme);
  const edRef = useRef<Monaco.editor.IStandaloneCodeEditor | null>(null);
  const decoRef = useRef<Monaco.editor.IEditorDecorationsCollection | null>(null);
  const clickRef = useRef(onLineClick);
  clickRef.current = onLineClick;

  const onMount: OnMount = (editor) => {
    edRef.current = editor;
    decoRef.current = editor.createDecorationsCollection([]);
    editor.onMouseDown((e) => {
      const ln = e.target.position?.lineNumber;
      if (ln && clickRef.current) clickRef.current(ln);
    });
    applyDecos();
  };

  const applyDecos = () => {
    if (!decoRef.current) return;
    const ds: Monaco.editor.IModelDeltaDecoration[] = [];
    for (const l of selectedLines ?? []) {
      ds.push({ range: { startLineNumber: l, endLineNumber: l, startColumn: 1, endColumn: 1 }, options: { isWholeLine: true, className: 'cc-bug-line', glyphMarginClassName: 'cc-bug-glyph' } });
    }
    for (const l of correctLines ?? []) {
      ds.push({ range: { startLineNumber: l, endLineNumber: l, startColumn: 1, endColumn: 1 }, options: { isWholeLine: true, className: 'cc-correct-line' } });
    }
    decoRef.current.set(ds);
  };

  useEffect(applyDecos, [selectedLines?.join(','), correctLines?.join(','), path]);

  return (
    <Editor
      path={path}
      value={value}
      language={language}
      theme={theme === 'light' ? 'cc-light' : 'cc-dark'}
      onMount={onMount}
      onChange={(v) => onChange?.(v ?? '')}
      options={{
        readOnly,
        minimap: { enabled: false },
        fontSize: 13,
        fontFamily: "'JetBrains Mono', ui-monospace, monospace",
        fontLigatures: true,
        scrollBeyondLastLine: false,
        glyphMargin: !!onLineClick,
        renderLineHighlight: 'all',
        smoothScrolling: true,
        tabSize: 2,
        automaticLayout: true,
        padding: { top: 10 },
        domReadOnly: false,
        readOnlyMessage: { value: 'This file is read-only for this stage.' },
        cursorStyle: onLineClick ? 'block-outline' : 'line',
        bracketPairColorization: { enabled: true },
      }}
      loading={<div className="p-4 text-xs text-muted">Loading editor…</div>}
    />
  );
}
