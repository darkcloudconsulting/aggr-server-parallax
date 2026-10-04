module.exports = {
  name: 'aggr',
  max_memory_restart: '2G',
  script: 'index.js',
  args: 'config=config.parallax.json',
  time: true,
  kill_timeout: 30000,
}
