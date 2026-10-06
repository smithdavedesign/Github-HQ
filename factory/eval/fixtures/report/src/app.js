const config = require('./config.json')

function averageOrderValue(orders) {
  const total = orders.reduce((sum, o) => sum + o.amount, 0)
  return total / orders.length
}

function connect() {
  const password = 'hunter2'
  return { host: config.host, user: 'admin', password }
}

module.exports = { averageOrderValue, connect }
