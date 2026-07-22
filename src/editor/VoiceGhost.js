import { Extension } from '@tiptap/core';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';

/**
 * @module editor/VoiceGhost
 * @description
 * Tiptap extension that renders the *interim* speech-to-text result as ghost text at the cursor.
 *
 * ### Why a decoration and not real content
 * Interim transcripts from {@link module:editor/VoiceAssistant VoiceAssistant} are provisional —
 * the backend revises them until the final result lands. Inserting them into the document would
 * push them through Yjs to every collaborator and pollute the undo history with text that is about
 * to be rewritten. Instead the preview is a ProseMirror **widget decoration**: it lives purely in
 * the view layer, never enters the document, never syncs, and never lands in an undo step.
 *
 * ### Data flow
 * `VoiceAssistant.onInterim(text)` → `editor.commands.setVoiceTranscript(text)` → extension storage
 * → the plugin's `decorations` prop rebuilds the widget at the current selection head. Passing an
 * empty string clears the preview; the final transcript is then inserted as ordinary content by
 * VoiceAssistant.
 *
 * The widget is placed with `side: 1` so it sits *after* the caret, and with `marks: []` so it does
 * not inherit bold/italic/link formatting from the surrounding text.
 */
export const VoiceGhost = Extension.create({
  name: 'voiceGhost',

  /**
   * @returns {{ HTMLAttributes: Object }} Extension options. `HTMLAttributes.class` is the styling
   *   hook for the ghost span (dimmed, non-selectable text).
   */
  addOptions() {
    return {
      HTMLAttributes: {
        class: 'voice-ghost-text',
      },
    };
  },

  /**
   * @returns {{ transcript: string }} Per-editor storage holding the current interim transcript.
   *   Empty string means "no preview". Read directly by the decoration plugin below.
   */
  addStorage() {
    return {
      transcript: '',
    };
  },

  /**
   * Registers the command used by the voice pipeline to update the preview.
   *
   * @returns {Object<string, Function>} `setVoiceTranscript(transcript)` writes the interim text to
   *   storage and always returns `true`. It mutates storage rather than dispatching a transaction,
   *   so it costs nothing in the document/undo history; the next view update repaints the widget.
   */
  addCommands() {
    return {
      setVoiceTranscript: (transcript) => ({ editor }) => {
        editor.storage.voiceGhost.transcript = transcript;
        return true;
      },
    };
  },

  /**
   * Builds the ProseMirror plugin that paints the ghost text.
   *
   * @returns {import('@tiptap/pm/state').Plugin[]} A single plugin whose `decorations` prop returns
   *   a widget decoration at the selection head while a transcript is buffered, and
   *   `DecorationSet.empty` otherwise.
   */
  addProseMirrorPlugins() {
    const { storage } = this;

    return [
      new Plugin({
        key: new PluginKey('voiceGhost'),
        props: {
          decorations(state) {
            const { transcript } = storage;
            if (!transcript) return DecorationSet.empty;

            const { selection } = state;
            const { head } = selection;

            const widget = Decoration.widget(head, () => {
              const span = document.createElement('span');
              span.className = 'voice-ghost-text';
              span.textContent = transcript;
              return span;
            }, {
              side: 1, // Show after the cursor
              marks: [], // Don't inherit surrounding marks
            });

            return DecorationSet.create(state.doc, [widget]);
          },
        },
      }),
    ];
  },
});
