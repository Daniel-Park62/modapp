module.exports = (function () {
  return {
    local: { // localhost
      host: '127.0.0.1',
      port: '3306',
      user: 'root',
      password: 'dawinit1',
      database: 'posco'
    },
    real: { // real server db info
      host: '',
      port: '3306',
      user: 'root',
      password: 'dawinit1',
      database: 'posco'
    },
    dev: { // dev server db info
      host: '',
      port: '',
      user: '',
      password: '',
      database: ''
    }
  }
})();
