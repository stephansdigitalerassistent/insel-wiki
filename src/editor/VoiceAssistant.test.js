/**
 * Unit tests for VoiceAssistant — src/editor/VoiceAssistant.js
 * Run with: node src/editor/VoiceAssistant.test.js
 *
 * Simple test runner — no framework needed (matches tests/utils.test.js).
 */

// Define mock globals before imports to handle environment dependencies in Node
let pendingTimers = [];

global.window = {
  location: {
    protocol: 'http:',
    host: 'localhost:3000'
  }
};

Object.defineProperty(global, 'navigator', {
  value: {
    mediaDevices: {
      getUserMedia: async () => {
        return {
          getTracks: () => [
            { stop: () => {} }
          ]
        };
      }
    }
  },
  configurable: true,
  writable: true
});

global.setTimeout = (fn, delay) => {
  const timer = { fn, delay };
  pendingTimers.push(timer);
  return timer;
};

global.clearTimeout = (timer) => {
  if (!timer) return;
  pendingTimers = pendingTimers.filter(t => t !== timer);
};

function runTimers() {
  const timers = [...pendingTimers];
  pendingTimers = [];
  for (const t of timers) {
    t.fn();
  }
}

const tick = () => new Promise(resolve => process.nextTick(resolve));

class MockMediaRecorder {
  constructor(stream, options) {
    this.stream = stream;
    this.options = options;
    this.state = 'inactive';
  }
  static isTypeSupported(mime) {
    return mime === 'audio/webm;codecs=opus';
  }
  start(timeslice) {
    this.state = 'recording';
  }
  stop() {
    this.state = 'inactive';
    if (this.onstop) this.onstop();
  }
}
global.MediaRecorder = MockMediaRecorder;

class MockWebSocket {
  constructor(url) {
    this.url = url;
    this.readyState = 0; // CONNECTING
    MockWebSocket.instances.push(this);
    setTimeout(() => {
      this.readyState = 1; // OPEN
      if (this.onopen) this.onopen();
    }, 0);
  }
  send(data) {
    MockWebSocket.sentData.push(data);
  }
  close(code) {
    this.readyState = 3; // CLOSED
    if (this.onclose) this.onclose({ code });
  }
}
MockWebSocket.CONNECTING = 0;
MockWebSocket.OPEN = 1;
MockWebSocket.CLOSING = 2;
MockWebSocket.CLOSED = 3;
MockWebSocket.instances = [];
MockWebSocket.sentData = [];
global.WebSocket = MockWebSocket;

const { auth } = await import('../firebase/config.js');
auth.currentUser = {
  getIdToken: async () => 'test-token'
};

const { VoiceAssistant } = await import('./VoiceAssistant.js');

let passed = 0;
let failed = 0;
const tests = [];

function test(name, fn) {
  tests.push({ name, fn });
}

function expect(actual) {
  return {
    toBe(expected) {
      if (actual !== expected) throw new Error(`Expected "${expected}" but got "${actual}"`);
    },
    toEqual(expected) {
      const a = JSON.stringify(actual);
      const e = JSON.stringify(expected);
      if (a !== e) throw new Error(`Expected ${e} but got ${a}`);
    },
    toHaveLength(n) {
      if (actual.length !== n) throw new Error(`Expected length ${n} but got ${actual.length}`);
    },
    toBeTruthy() {
      if (!actual) throw new Error(`Expected truthy but got "${actual}"`);
    },
    toBeFalsy() {
      if (actual) throw new Error(`Expected falsy but got "${actual}"`);
    }
  };
}

// Helper to construct a mock editor that matches the interface VoiceAssistant calls
const createMockEditor = (initialText = '', selectionFrom = 1) => {
  let currentText = initialText;
  let cursor = selectionFrom;
  const calls = [];

  const chain = {
    focus() {
      calls.push('focus');
      return this;
    },
    insertContent(content) {
      calls.push({ name: 'insertContent', content });
      return this;
    },
    deleteRange(from, to) {
      calls.push({ name: 'deleteRange', from, to });
      return this;
    },
    insertContentAt(pos, content) {
      calls.push({ name: 'insertContentAt', pos, content });
      return this;
    },
    enter() {
      calls.push('enter');
      return this;
    },
    setHardBreak() {
      calls.push('setHardBreak');
      return this;
    },
    deleteSelection() {
      calls.push('deleteSelection');
      return this;
    },
    undo() {
      calls.push('undo');
      return this;
    },
    redo() {
      calls.push('redo');
      return this;
    },
    toggleBold() {
      calls.push('toggleBold');
      return this;
    },
    toggleItalic() {
      calls.push('toggleItalic');
      return this;
    },
    toggleUnderline() {
      calls.push('toggleUnderline');
      return this;
    },
    toggleHeading(opts) {
      calls.push({ name: 'toggleHeading', opts });
      return this;
    },
    toggleBulletList() {
      calls.push('toggleBulletList');
      return this;
    },
    toggleOrderedList() {
      calls.push('toggleOrderedList');
      return this;
    },
    toggleTaskList() {
      calls.push('toggleTaskList');
      return this;
    },
    run() {
      calls.push('run');
      return true;
    }
  };

  return {
    state: {
      selection: { from: cursor },
      doc: {
        textBetween(from, to) {
          const start = Math.max(0, from - 1);
          const end = Math.max(0, to - 1);
          return currentText.substring(start, end);
        }
      }
    },
    chain() {
      return chain;
    },
    calls
  };
};

// ──────────────────────────────────────────────
// 🎤 VoiceAssistant Unit Coverage
// ──────────────────────────────────────────────
console.log('\n🎤 VoiceAssistant Unit Coverage');

test('VoiceAssistant initialized in expected default state', () => {
  const editor = createMockEditor();
  const assistant = new VoiceAssistant(editor);

  expect(assistant.editor).toBe(editor);
  expect(assistant.lang).toBe('de-DE');
  expect(assistant.isRecording).toBe(false);
  expect(assistant._consecutiveFailures).toBe(0);
});

test('VoiceAssistant._pickMimeType picks best MIME type', () => {
  const editor = createMockEditor();
  const assistant = new VoiceAssistant(editor);

  // Test when MediaRecorder is undefined
  const originalMediaRecorder = global.MediaRecorder;
  delete global.MediaRecorder;
  expect(assistant._pickMimeType()).toBe(null);

  // Test when MediaRecorder is defined but no types are supported
  global.MediaRecorder = class {
    static isTypeSupported() { return false; }
  };
  expect(assistant._pickMimeType()).toBe(null);

  // Test fallback
  global.MediaRecorder = class {
    static isTypeSupported(t) { return t === 'audio/webm'; }
  };
  expect(assistant._pickMimeType()).toBe('audio/webm');

  // Test preferred
  global.MediaRecorder = originalMediaRecorder;
  expect(assistant._pickMimeType()).toBe('audio/webm;codecs=opus');
});

test('VoiceAssistant.start fails if no auth user', async () => {
  const editor = createMockEditor();
  const assistant = new VoiceAssistant(editor);

  const originalUser = auth.currentUser;
  auth.currentUser = null;

  let failedCode = null;
  let failedMessage = null;
  assistant.onError = (code, msg) => {
    failedCode = code;
    failedMessage = msg;
  };

  await assistant.start();
  expect(failedCode).toBe('auth');
  expect(failedMessage).toBe('Bitte zuerst anmelden, um die Spracheingabe zu nutzen.');
  expect(assistant.isRecording).toBe(false);

  auth.currentUser = originalUser;
});

test('VoiceAssistant.start fails if mic is denied', async () => {
  const editor = createMockEditor();
  const assistant = new VoiceAssistant(editor);

  const originalGetUserMedia = global.navigator.mediaDevices.getUserMedia;
  global.navigator.mediaDevices.getUserMedia = async () => {
    throw new Error('Permission denied');
  };

  let failedCode = null;
  assistant.onError = (code) => {
    failedCode = code;
  };

  await assistant.start();
  expect(failedCode).toBe('mic-denied');
  expect(assistant.isRecording).toBe(false);

  global.navigator.mediaDevices.getUserMedia = originalGetUserMedia;
});

test('VoiceAssistant.start succeeds and initiates WebSocket session', async () => {
  MockWebSocket.instances = [];
  MockWebSocket.sentData = [];
  pendingTimers = [];

  const editor = createMockEditor();
  const assistant = new VoiceAssistant(editor);

  let stateChanged = null;
  assistant.onStateChange = (state) => {
    stateChanged = state;
  };

  await assistant.start();

  expect(assistant.isRecording).toBe(true);
  expect(stateChanged).toBe(true);

  // Check WebSocket was created
  expect(MockWebSocket.instances.length).toBe(1);
  const ws = MockWebSocket.instances[0];
  expect(ws.url).toBe('ws://localhost:3000/api/transcribe');

  // Fast-forward connection timer to trigger onopen
  runTimers();

  // Verify auth message was sent
  expect(MockWebSocket.sentData.length).toBe(1);
  const authMsg = JSON.parse(MockWebSocket.sentData[0]);
  expect(authMsg.type).toBe('auth');
  expect(authMsg.token).toBe('test-token');
  expect(authMsg.lang).toBe('de-DE');

  // Simulate ready message
  let recorderStarted = false;
  assistant._startRecorder = () => {
    recorderStarted = true;
  };

  ws.onmessage({ data: JSON.stringify({ type: 'ready' }) });
  expect(recorderStarted).toBe(true);

  assistant.stop();
  expect(assistant.isRecording).toBe(false);
  expect(stateChanged).toBe(false);
});

test('VoiceAssistant startRecorder and ondataavailable sending', async () => {
  MockWebSocket.instances = [];
  MockWebSocket.sentData = [];
  const editor = createMockEditor();
  const assistant = new VoiceAssistant(editor);

  await assistant.start();
  runTimers();
  const ws = MockWebSocket.instances[0];
  ws.readyState = 1; // OPEN

  assistant._startRecorder(ws);
  expect(assistant._recorder).toBeTruthy();
  expect(assistant._recorder.state).toBe('recording');

  // Simulate ondataavailable
  const mockData = { size: 100 };
  assistant._recorder.ondataavailable({ data: mockData });

  expect(MockWebSocket.sentData.includes(mockData)).toBeTruthy();

  assistant.stop();
});

test('VoiceAssistant processes interim and final transcripts', async () => {
  MockWebSocket.instances = [];
  const editor = createMockEditor();
  const assistant = new VoiceAssistant(editor);

  let interimText = null;
  assistant.onInterim = (text) => {
    interimText = text;
  };

  await assistant.start();
  runTimers();
  const ws = MockWebSocket.instances[0];

  // Send ready
  ws.onmessage({ data: JSON.stringify({ type: 'ready' }) });

  // Send interim
  ws.onmessage({ data: JSON.stringify({ type: 'interim', transcript: 'hallo welt' }) });
  expect(interimText).toBe('hallo welt');

  // Send final
  let finalReceived = null;
  assistant._handleFinalTranscript = (text) => {
    finalReceived = text;
  };
  ws.onmessage({ data: JSON.stringify({ type: 'final', transcript: 'hallo welt' }) });
  expect(finalReceived).toBe('hallo welt');
  expect(interimText).toBe(''); // cleared after final

  assistant.stop();
});

test('VoiceAssistant reconnects on unexpected socket close', async () => {
  MockWebSocket.instances = [];
  pendingTimers = [];
  const editor = createMockEditor();
  const assistant = new VoiceAssistant(editor);

  let failedCode = null;
  assistant.onError = (code) => {
    failedCode = code;
  };

  await assistant.start();
  runTimers();
  await tick();

  // Trigger close with code 1006 (abnormal closure)
  const ws1 = MockWebSocket.instances[0];
  ws1.onclose({ code: 1006 });

  // Reconnect should be scheduled
  expect(assistant._consecutiveFailures).toBe(1);
  expect(assistant._reconnectTimer).toBeTruthy();

  // Fast-forward reconnect timer
  runTimers();
  await tick();

  // Verify second connection attempt
  expect(MockWebSocket.instances.length).toBe(2);
  const ws2 = MockWebSocket.instances[1];

  // Trigger close again
  ws2.onclose({ code: 1006 });
  expect(assistant._consecutiveFailures).toBe(2);

  // Fast-forward next reconnect
  runTimers();
  await tick();
  expect(MockWebSocket.instances.length).toBe(3);
  const ws3 = MockWebSocket.instances[2];

  // Trigger close again -> this exceeds MAX_CONSECUTIVE_FAILURES (3)
  ws3.onclose({ code: 1006 });
  expect(failedCode).toBe('backend');
  expect(assistant.isRecording).toBe(false);
});

test('VoiceAssistant._handleFinalTranscript capitalizes sentence start', () => {
  const editor = createMockEditor('', 1); // Empty editor (cursor at pos 1)
  const assistant = new VoiceAssistant(editor);

  assistant._handleFinalTranscript('hallo welt');
  expect(editor.calls.length).toBe(3);
  expect(editor.calls[1].content).toBe('Hallo welt '); // capitalized

  // Test non-start position
  const editor2 = createMockEditor('Das ist ein Test', 17);
  const assistant2 = new VoiceAssistant(editor2);
  assistant2._handleFinalTranscript('hallo welt');
  expect(editor2.calls[1].content).toBe('hallo welt '); // not capitalized

  // Test after sentence-ending punctuation + space
  const editor3 = createMockEditor('Das ist ein Test. ', 19);
  const assistant3 = new VoiceAssistant(editor3);
  assistant3._handleFinalTranscript('hallo welt');
  expect(editor3.calls[1].content).toBe('Hallo welt '); // capitalized
});

test('VoiceAssistant._handleFinalTranscript executes matching voice commands', () => {
  const editor = createMockEditor();
  const assistant = new VoiceAssistant(editor);

  // Command: "neuer absatz"
  assistant._handleFinalTranscript('neuer absatz');
  expect(editor.calls.includes('enter')).toBeTruthy();
  expect(editor.calls.includes('run')).toBeTruthy();

  // Command with prefix: "bitte neuer absatz" -> should also match (ends with ' neuer absatz')
  const editor2 = createMockEditor();
  const assistant2 = new VoiceAssistant(editor2);
  assistant2._handleFinalTranscript('bitte neuer absatz');
  expect(editor2.calls.includes('enter')).toBeTruthy();

  // Formatting: "fett"
  const editor3 = createMockEditor();
  const assistant3 = new VoiceAssistant(editor3);
  assistant3._handleFinalTranscript('fett');
  expect(editor3.calls.includes('toggleBold')).toBeTruthy();
});

test('VoiceAssistant._handleFinalTranscript executes voice punctuation commands', () => {
  // Case 1: Preceding character is space (should absorb space)
  const editor = createMockEditor('hallo ', 7);
  const assistant = new VoiceAssistant(editor);

  assistant._handleFinalTranscript('punkt');

  // It should delete the space (from 6 to 7) and insertContentAt(6, '. ')
  const deleteCall = editor.calls.find(c => c.name === 'deleteRange');
  expect(deleteCall).toBeTruthy();
  expect(deleteCall.from).toBe(6);
  expect(deleteCall.to).toBe(7);

  const insertCall = editor.calls.find(c => c.name === 'insertContentAt');
  expect(insertCall).toBeTruthy();
  expect(insertCall.pos).toBe(6);
  expect(insertCall.content).toBe('. ');

  // Case 2: Preceding character is not a space
  const editor2 = createMockEditor('hallo', 6);
  const assistant2 = new VoiceAssistant(editor2);

  assistant2._handleFinalTranscript('punkt');

  // It should just insertContent('. ')
  const insertCall2 = editor2.calls.find(c => c.name === 'insertContent');
  expect(insertCall2).toBeTruthy();
  expect(insertCall2.content).toBe('. ');
});

test('VoiceAssistant toggle and destroy teardown', async () => {
  const editor = createMockEditor();
  const assistant = new VoiceAssistant(editor);

  expect(assistant.isRecording).toBe(false);
  await assistant.toggle();
  expect(assistant.isRecording).toBe(true);

  await assistant.toggle();
  expect(assistant.isRecording).toBe(false);

  // Destroy clean resources
  assistant.destroy();
  expect(assistant._ws).toBe(null);
});

// Run tests sequentially
for (const { name, fn } of tests) {
  try {
    const res = fn();
    if (res instanceof Promise) {
      await res;
    }
    passed++;
    console.log(`  ✓ ${name}`);
  } catch (err) {
    failed++;
    console.error(`  ✕ ${name}`);
    console.error(`    ${err.message}`);
  }
}

// ──────────────────────────────────────────────
// Summary
// ──────────────────────────────────────────────
console.log(`\n${'─'.repeat(40)}`);
console.log(`Results: ${passed} passed, ${failed} failed`);
if (failed > 0) {
  console.log('❌ Some tests failed!');
  process.exit(1);
} else {
  console.log('✅ All tests passed!');
}
