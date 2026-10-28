import {
  useEffect,
  useImperativeHandle,
  useRef,
  forwardRef,
  type Ref,
} from 'react';
import { basicSetup } from 'codemirror';
import { EditorState, Prec } from '@codemirror/state';
import {
  EditorView,
  keymap,
  placeholder as placeholderExt,
} from '@codemirror/view';
import { sql, PostgreSQL } from '@codemirror/lang-sql';
import {
  HighlightStyle,
  bracketMatching,
  indentOnInput,
  syntaxHighlighting,
} from '@codemirror/language';
import { tags } from '@lezer/highlight';

export interface SqlEditorSchema {
  name: string;
  columns: string[];
}

export interface SqlEditorHandle {
  insert: (text: string) => void;
  focus: () => void;
}

const atlasTheme = EditorView.theme(
  {
    '&': {
      backgroundColor: 'transparent',
      color: '#e7e9e1',
      fontSize: '13px',
    },
    '.cm-scroller': {
      fontFamily:
        '"SFMono-Regular", ui-monospace, "Cascadia Code", Menlo, monospace',
      lineHeight: '1.72',
    },
    '.cm-content': {
      padding: '16px 0 20px',
      caretColor: '#d9b36c',
    },
    '.cm-line': {
      padding: '0 20px',
    },
    '.cm-gutters': {
      backgroundColor: 'transparent',
      border: 'none',
      color: '#4c564f',
      paddingLeft: '10px',
    },
    '.cm-activeLine': {
      backgroundColor: 'rgba(255,255,255,0.024)',
    },
    '.cm-activeLineGutter': {
      backgroundColor: 'transparent',
      color: '#9aa39b',
    },
    '.cm-cursor, .cm-dropCursor': {
      borderLeftColor: '#d9b36c',
    },
    '&.cm-focused': {
      outline: 'none',
    },
    '.cm-selectionBackground, .cm-content ::selection': {
      backgroundColor: 'rgba(217,179,108,0.18) !important',
    },
    '.cm-selectionMatch': {
      backgroundColor: 'rgba(217,179,108,0.1)',
    },
    '.cm-matchingBracket': {
      backgroundColor: 'rgba(159,208,164,0.16)',
      outline: '1px solid rgba(159,208,164,0.3)',
    },
    '.cm-tooltip': {
      backgroundColor: '#171c19',
      border: '1px solid rgba(235,238,230,0.12)',
      borderRadius: '8px',
      boxShadow: '0 12px 40px rgba(0,0,0,0.5)',
      color: '#e7e9e1',
    },
    '.cm-tooltip-autocomplete > ul > li[aria-selected]': {
      backgroundColor: 'rgba(217,179,108,0.16)',
      color: '#f2e6c9',
    },
    '.cm-completionLabel': {
      fontFamily:
        '"SFMono-Regular", ui-monospace, "Cascadia Code", Menlo, monospace',
    },
    '.cm-placeholder': {
      color: '#56615a',
    },
  },
  { dark: true },
);

const atlasHighlight = HighlightStyle.define([
  { tag: tags.keyword, color: '#d9b36c', fontWeight: '600' },
  { tag: [tags.string, tags.special(tags.string)], color: '#9fd0a4' },
  { tag: tags.number, color: '#8faee8' },
  { tag: tags.bool, color: '#8faee8' },
  { tag: tags.null, color: '#8faee8' },
  { tag: tags.comment, color: '#5d685f', fontStyle: 'italic' },
  { tag: [tags.name, tags.propertyName], color: '#e7e9e1' },
  { tag: tags.variableName, color: '#e7e9e1' },
  { tag: tags.operator, color: '#c4a7df' },
  { tag: tags.punctuation, color: '#8c968e' },
  { tag: tags.typeName, color: '#b7a0e6' },
  { tag: tags.function(tags.variableName), color: '#7fc9bc' },
  { tag: tags.definition(tags.variableName), color: '#e7e9e1' },
]);

export const SqlEditor = forwardRef(function SqlEditor(
  {
    value,
    onChange,
    onRun,
    schema,
  }: {
    value: string;
    onChange: (value: string) => void;
    onRun: () => void;
    schema: SqlEditorSchema[];
  },
  ref: Ref<SqlEditorHandle>,
) {
  const containerRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const onChangeRef = useRef(onChange);
  const onRunRef = useRef(onRun);
  const updatingRef = useRef(false);

  onChangeRef.current = onChange;
  onRunRef.current = onRun;

  useImperativeHandle(ref, () => ({
    insert(text: string) {
      const view = viewRef.current;
      if (!view) return;
      const { from, to } = view.state.selection.main;
      view.dispatch({
        changes: { from, to, insert: text },
        selection: { anchor: from + text.length },
      });
      view.focus();
    },
    focus() {
      viewRef.current?.focus();
    },
  }));

  useEffect(() => {
    if (!containerRef.current) return;
    const schemaMap: Record<string, string[]> = {};
    for (const entry of schema) {
      schemaMap[entry.name] = entry.columns;
    }

    const state = EditorState.create({
      doc: value,
      extensions: [
        basicSetup,
        sql({ dialect: PostgreSQL, schema: schemaMap, upperCaseKeywords: true }),
        atlasTheme,
        syntaxHighlighting(atlasHighlight),
        bracketMatching(),
        indentOnInput(),
        placeholderExt('-- 输入 SQL，按 ⌘/Ctrl + Enter 运行'),
        Prec.highest(
          keymap.of([
            {
              key: 'Mod-Enter',
              run: () => {
                onRunRef.current();
                return true;
              },
            },
            {
              key: 'Shift-Enter',
              run: () => {
                onRunRef.current();
                return true;
              },
            },
          ]),
        ),
        EditorView.updateListener.of((update) => {
          if (update.docChanged && !updatingRef.current) {
            onChangeRef.current(update.state.doc.toString());
          }
        }),
      ],
    });

    const view = new EditorView({ state, parent: containerRef.current });
    viewRef.current = view;
    return () => {
      view.destroy();
      viewRef.current = null;
    };
    // The editor is created once; external values are synced below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    const current = view.state.doc.toString();
    if (current === value) return;
    updatingRef.current = true;
    view.dispatch({
      changes: { from: 0, to: current.length, insert: value },
    });
    updatingRef.current = false;
  }, [value]);

  return <div className="sql-editor" ref={containerRef} />;
});
