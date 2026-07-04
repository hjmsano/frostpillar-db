import type {
  ChangeEvent,
  ChangeEventType,
  ChangeListener,
  FrostpillarDocument,
  FrostpillarStoredDocument,
} from '../types.js';
import { cloneDocument } from './objectUtils.js';

export class ChangeEmitter<
  TDocument extends FrostpillarDocument = FrostpillarDocument,
> {
  private readonly listeners: ChangeListener<TDocument>[] = [];
  private onListenerError: ((error: unknown) => void) | undefined;

  public setErrorHandler(handler: (error: unknown) => void): void {
    this.onListenerError = handler;
  }

  public watch(listener: ChangeListener<TDocument>): () => void {
    this.listeners.push(listener);
    return () => {
      const index = this.listeners.indexOf(listener);
      if (index !== -1) {
        this.listeners.splice(index, 1);
      }
    };
  }

  public emit(
    type: ChangeEventType,
    collectionName: string,
    documentId: string,
    document: FrostpillarStoredDocument<TDocument> | null,
  ): void {
    if (this.listeners.length === 0) {
      return;
    }
    const event: ChangeEvent<TDocument> = {
      type,
      collection: collectionName,
      documentId,
      document: document ? cloneDocument(document) : null,
    };
    const snapshot = [...this.listeners];
    for (const listener of snapshot) {
      try {
        listener(event);
      } catch (error: unknown) {
        if (this.onListenerError !== undefined) {
          try {
            this.onListenerError(error);
          } catch {
            // Error handler itself must not throw
          }
        }
      }
    }
  }
}
