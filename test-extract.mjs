import { extractTasksFromContent } from './src/utils/tasks.js';
import TurndownService from 'turndown';

const turndownInstance = new TurndownService({
  headingStyle: 'atx',
  codeBlockStyle: 'fenced',
});

turndownInstance.addRule('taskItems', {
  filter: function (node) {
    return node.nodeName === 'LI' && (node.getAttribute('data-type') === 'taskItem' || node.hasAttribute('data-checked'));
  },
  replacement: function (content, node) {
    const checked = node.getAttribute('data-checked') === 'true';
    return (checked ? '- [x] ' : '- [ ] ') + content.trim() + '\n';
  }
});

const html = '<ul data-type="taskList"><li data-checked="false"><label contenteditable="false"><input aria-label="Task item checkbox for empty task item" type="checkbox"><span></span></label><div><p>Task-1777397645005</p></div></li><li data-checked="false"><label contenteditable="false"><input aria-label="Task item checkbox for empty task item" type="checkbox"><span></span></label><div><p><br class="ProseMirror-trailingBreak"></p></div></li></ul>';

const markdown = turndownInstance.turndown(html);
console.log('Markdown:');
console.log(JSON.stringify(markdown));

console.log('Tasks extracted:');
console.log(extractTasksFromContent(markdown));
