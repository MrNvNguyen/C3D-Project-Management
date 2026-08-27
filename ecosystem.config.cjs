module.exports = {
  apps: [
    {
      name: 'bim-management',
      script: 'bash',
      args: 'start-server.sh',
      env: {
        NODE_ENV: 'development',
        PORT: 3000
      },
      watch: false,
      instances: 1,
      exec_mode: 'fork'
    }
  ]
}
