type Handler<T> = (payload: T) => void;

/** Minimal typed event emitter, so the CV module does not depend on React. */
export class Emitter<M> {
  private handlers = new Map<keyof M, Set<Handler<never>>>();

  /** Subscribes to an event. Returns a function that unsubscribes. */
  on<K extends keyof M>(type: K, handler: Handler<M[K]>): () => void {
    let set = this.handlers.get(type);
    if (!set) {
      set = new Set();
      this.handlers.set(type, set);
    }
    set.add(handler as Handler<never>);
    return () => set.delete(handler as Handler<never>);
  }

  emit<K extends keyof M>(type: K, payload: M[K]): void {
    this.handlers.get(type)?.forEach((handler) => (handler as Handler<M[K]>)(payload));
  }
}
