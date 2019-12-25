const Sequencer = require('@jest/test-sequencer').default;
const path = require('path')

const order = require(path.join(__dirname, '__tests__', 'cases', 'order.json'))

class CustomSequencer extends Sequencer {
  sort(tests) {
    const paths = tests.map(t => t.path)
    const ordered = order
      .filter(p => paths.includes(p)) // only use paths from order that are in tests -- should be all
      .concat(paths.filter(p => !order.includes(p))) // use paths not found in order -- should be none
      .map(p => tests.find(t => t.path === p)) // map back to tests
    return ordered
  }
}

module.exports = CustomSequencer;
