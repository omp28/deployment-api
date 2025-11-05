const express = require('express');
const { exec } = require('child_process');
const cors = require('cors');

const app = express();
const PORT = process.env.PORT || 3002;
const SCRIPTS_DIR = process.env.SCRIPTS_DIR || '/home/omkumar.patel/nomad-config';

app.use(cors());
app.use(express.json());
app.use(express.static('public'));

// Helper to execute commands
const execCommand = (command, cwd = SCRIPTS_DIR) => {
  return new Promise((resolve, reject) => {
    exec(command, { cwd, maxBuffer: 1024 * 1024 * 10 }, (error, stdout, stderr) => {
      if (error) {
        reject({ error: error.message, stderr, stdout });
      } else {
        resolve({ stdout, stderr });
      }
    });
  });
};

// Health check
app.get('/health', (req, res) => {
  res.json({ 
    status: 'ok', 
    message: 'Deployment API is running',
    timestamp: new Date().toISOString()
  });
});

// List all deployments
app.get('/deployments', async (req, res) => {
  try {
    const { stdout } = await execCommand('docker ps --filter "name=app1_" --format "{{.Names}}|{{.Ports}}|{{.Status}}"');
    
    const deployments = stdout.trim().split('\n')
      .filter(line => line)
      .map(line => {
        const [name, ports, status] = line.split('|');
        const branch = name.replace('app1_', '');
        const port = ports.match(/0\.0\.0\.0:(\d+)->/)?.[1] || 'N/A';
        
        return {
          branch,
          container: name,
          port,
          status,
          url: `http://135.235.193.224:3001/${branch}/`
        };
      });

    res.json({ success: true, deployments });
  } catch (error) {
    res.status(500).json({ 
      success: false, 
      error: 'Failed to fetch deployments', 
      details: error.stdout || error.error 
    });
  }
});

// List available branches
app.get('/branches', async (req, res) => {
  try {
    const repoDir = '/home/omkumar.patel/repos/app1';
    
    // Fetch latest branches
    await execCommand('git fetch origin', repoDir);
    const { stdout } = await execCommand('git branch -r', repoDir);
    
    const branches = stdout.trim().split('\n')
      .map(b => b.trim().replace('origin/', ''))
      .filter(b => b && !b.includes('HEAD'));

    res.json({ success: true, branches });
  } catch (error) {
    res.status(500).json({ 
      success: false, 
      error: 'Failed to fetch branches', 
      details: error.stdout || error.error 
    });
  }
});

// Get Caddy routes
app.get('/routes', async (req, res) => {
  try {
    const { stdout } = await execCommand('curl -s http://127.0.0.1:2020/config/apps/http/servers/srv0/routes');
    const routes = JSON.parse(stdout);
    
    const formattedRoutes = routes.map((route, index) => ({
      index,
      path: route.match[0]?.path[0] || 'N/A',
      upstream: route.handle[0]?.upstreams?.[0]?.dial || 'N/A',
      type: route.handle[0]?.handler || 'reverse_proxy',
      stripPrefix: route.handle[0]?.rewrite?.strip_path_prefix || null
    }));

    res.json({ success: true, routes: formattedRoutes });
  } catch (error) {
    res.status(500).json({ 
      success: false, 
      error: 'Failed to fetch routes', 
      details: error.error 
    });
  }
});

// Deploy a branch
app.post('/deploy', async (req, res) => {
  const { branch } = req.body;

  if (!branch) {
    return res.status(400).json({ success: false, error: 'Branch name is required' });
  }

  if (!/^[a-zA-Z0-9_-]+$/.test(branch)) {
    return res.status(400).json({ success: false, error: 'Invalid branch name' });
  }

  try {
    console.log(`🚀 Deploying branch: ${branch}`);
    const { stdout, stderr } = await execCommand(`bash deploy.sh ${branch}`);
    
    res.json({
      success: true,
      message: `Successfully deployed ${branch}`,
      branch,
      output: stdout,
      warnings: stderr
    });
  } catch (error) {
    console.error(`❌ Deployment failed for ${branch}:`, error);
    res.status(500).json({
      success: false,
      error: `Failed to deploy ${branch}`,
      details: error.stdout || error.error,
      stderr: error.stderr
    });
  }
});

// Cleanup a deployment
app.delete('/cleanup/:branch', async (req, res) => {
  const { branch } = req.params;

  if (!/^[a-zA-Z0-9_-]+$/.test(branch)) {
    return res.status(400).json({ success: false, error: 'Invalid branch name' });
  }

  try {
    console.log(`🧹 Cleaning up branch: ${branch}`);
    const { stdout, stderr } = await execCommand(`bash cleanup.sh ${branch}`);
    
    res.json({
      success: true,
      message: `Successfully cleaned up ${branch}`,
      branch,
      output: stdout,
      warnings: stderr
    });
  } catch (error) {
    console.error(`❌ Cleanup failed for ${branch}:`, error);
    res.status(500).json({
      success: false,
      error: `Failed to cleanup ${branch}`,
      details: error.stdout || error.error,
      stderr: error.stderr
    });
  }
});

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('SIGTERM received, shutting down gracefully...');
  process.exit(0);
});

process.on('SIGINT', () => {
  console.log('SIGINT received, shutting down gracefully...');
  process.exit(0);
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 Deployment API running on http://0.0.0.0:${PORT}`);
  console.log(`📁 Scripts directory: ${SCRIPTS_DIR}`);
  console.log(`📡 Endpoints:`);
  console.log(`   GET    /health`);
  console.log(`   GET    /deployments`);
  console.log(`   GET    /branches`);
  console.log(`   GET    /routes`);
  console.log(`   POST   /deploy`);
  console.log(`   DELETE /cleanup/:branch`);
});