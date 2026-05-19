import { Extension } from '@tiptap/core';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';

export const VoiceGhost = Extension.create({
  name: 'voiceGhost',

  addOptions() {
    return {
      HTMLAttributes: {
        class: 'voice-ghost-text',
      },
    };
  },

  addStorage() {
    return {
      transcript: '',
    };
  },

  addCommands() {
    return {
      setVoiceTranscript: (transcript) => ({ storage }) => {
        storage.transcript = transcript;
        return true;
      },
    };
  },

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
