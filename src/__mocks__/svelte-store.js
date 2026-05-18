export function writable(initialValue) {
  let value = initialValue
  const subscribers = new Set()

  function notify() {
    subscribers.forEach(subscriber => subscriber(value))
  }

  return {
    subscribe(subscriber) {
      subscribers.add(subscriber)
      subscriber(value)
      return () => subscribers.delete(subscriber)
    },
    set(nextValue) {
      value = nextValue
      notify()
    },
    update(updater) {
      value = updater(value)
      notify()
    },
  }
}
