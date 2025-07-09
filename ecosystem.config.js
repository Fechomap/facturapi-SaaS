// ecosystem.config.js - Configuración PM2 para Railway y producción
module.exports = {
  apps: [
    {
      name: 'facturapi-saas-cluster',
      script: './cluster.js',
      instances: 'max', // Usar todos los CPUs disponibles
      exec_mode: 'cluster',
      
      // Configuración de entorno
      env: {
        NODE_ENV: 'development',
        PORT: 3000
      },
      env_production: {
        NODE_ENV: 'production',
        PORT: process.env.PORT || 3000
      },
      
      // Configuración de escalabilidad para Railway
      max_memory_restart: '1G', // Reiniciar si excede 1GB de RAM
      instances_scaling: {
        min_uptime: '10s',
        max_restarts: 5,
        restart_delay: 4000
      },
      
      // Logging
      log_file: './logs/combined.log',
      out_file: './logs/out.log',
      error_file: './logs/error.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
      
      // Configuración de clustering avanzada
      listen_timeout: 10000,
      kill_timeout: 5000,
      
      // Variables específicas para Railway
      env_railway: {
        NODE_ENV: 'production',
        IS_RAILWAY: 'true',
        PORT: process.env.PORT || 3000
      },
      
      // Monitoreo de performance
      pmx: true,
      
      // Configuración de auto-restart
      watch: false, // Deshabilitado en producción
      ignore_watch: ['node_modules', 'logs', '.git'],
      
      // Configuración de memoria y CPU
      max_memory_restart: '1G',
      
      // Scripts de deployment
      post_update: ['npm install', 'npx prisma generate'],
      
      // Configuración de clustering específica
      merge_logs: true,
      combine_logs: true,
      
      // Configuración para Railway deployment
      source_map_support: true,
      instance_var: 'INSTANCE_ID'
    },
    
    // Aplicación standalone (sin clustering) para desarrollo
    {
      name: 'facturapi-saas-dev',
      script: './server.js',
      instances: 1,
      exec_mode: 'fork',
      
      env: {
        NODE_ENV: 'development',
        PORT: 3000
      },
      
      watch: true,
      ignore_watch: ['node_modules', 'logs', '.git', 'frontend/build'],
      
      // Solo para desarrollo local
      autorestart: true,
      max_restarts: 10,
      min_uptime: '5s'
    }
  ],
  
  // Configuración de deployment para Railway
  deploy: {
    production: {
      user: 'railway',
      host: 'railway.app',
      ref: 'origin/main',
      repo: 'git@github.com:tu-usuario/facturapi-saas.git',
      path: '/app',
      'post-deploy': 'npm install && npx prisma generate && pm2 reload ecosystem.config.js --env production'
    }
  }
};