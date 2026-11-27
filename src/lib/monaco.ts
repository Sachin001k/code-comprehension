import * as monaco from 'monaco-editor';
import { loader } from '@monaco-editor/react';
import EditorWorker from 'monaco-editor/editor/editor.worker.js?worker';
import TsWorker from 'monaco-editor/languages/features/typescript/ts.worker.js?worker';
import JsonWorker from 'monaco-editor/languages/features/json/json.worker.js?worker';

self.MonacoEnvironment = {
  getWorker(_id: string, label: string) {
    if (label === 'typescript' || label === 'javascript') return new TsWorker();
    if (label === 'json') return new JsonWorker();
    return new EditorWorker();
  },
};

// Problems are small isolated repos: keep TS diagnostics quiet about missing globals (test, expect, require).
const ts = monaco.typescript;
if (ts?.typescriptDefaults) {
  for (const d of [ts.typescriptDefaults, ts.javascriptDefaults]) {
    d.setDiagnosticsOptions({ noSemanticValidation: true, noSyntaxValidation: false });
    d.setCompilerOptions({ target: ts.ScriptTarget.ES2020, allowNonTsExtensions: true, module: ts.ModuleKind.ESNext, allowJs: true });
  }
}

monaco.editor.defineTheme('cc-dark', {
  base: 'vs-dark', inherit: true, rules: [],
  colors: { 'editor.background': '#0e141b', 'editorGutter.background': '#0e141b', 'editor.lineHighlightBackground': '#16202b', 'editorLineNumber.foreground': '#4a5a6e' },
});
monaco.editor.defineTheme('cc-light', { base: 'vs', inherit: true, rules: [], colors: { 'editor.background': '#ffffff' } });

loader.config({ monaco });

export { monaco };
