/**
 * A helper class to automatically chunk Firestore writes into multiple batches.
 * Works with both Firebase Admin SDK (server-side) and Firebase JS SDK (client-side).
 */
export class BatchCommitter {
  constructor(db, batchCreator) {
    this.db = db;
    this.batchCreator = batchCreator || (db && typeof db.batch === 'function' ? () => db.batch() : null);
    if (!this.batchCreator) {
      throw new Error('BatchCommitter: batchCreator function must be provided');
    }
    this.batches = [this.batchCreator()];
    this.count = 0;
  }

  set(ref, data, options) {
    const currentBatch = this.batches[this.batches.length - 1];
    if (options) {
      currentBatch.set(ref, data, options);
    } else {
      currentBatch.set(ref, data);
    }
    this._increment();
  }

  update(ref, data) {
    const currentBatch = this.batches[this.batches.length - 1];
    currentBatch.update(ref, data);
    this._increment();
  }

  delete(ref) {
    const currentBatch = this.batches[this.batches.length - 1];
    currentBatch.delete(ref);
    this._increment();
  }

  _increment() {
    this.count++;
    if (this.count >= 400) {
      this.batches.push(this.batchCreator());
      this.count = 0;
    }
  }

  async commit() {
    for (const batch of this.batches) {
      await batch.commit();
    }
  }
}
