require('dotenv').config();
const express = require('express');
const { execFile } = require('child_process');
const path = require('path');
const cors = require('cors');
const bodyParser = require('body-parser');
const fs = require('fs');
const sanitize = require('sanitize-filename');

const app = express();
const PORT = process.env.PORT || 3000;
const BASE_URL = process.env.BASE_URL || `http://localhost:${PORT}`;

// Configurações de segurança e middleware
app.use(cors({
  origin: process.env.CORS_ORIGIN || '*', // Permitir todas as origens para testes
  methods: ['POST']
}));
app.use(bodyParser.json({ limit: '10mb' }));
app.use(express.static(path.join(__dirname, 'downloads'), {
  setHeaders: (res) => {
    res.set('X-Content-Type-Options', 'nosniff');
  }
}));
app.use(express.static(path.join(__dirname, 'public')));

// Rota para servir o index.html como padrão
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Validação de URL
const isValidUrl = (url) => {
  const pattern = /^(https?:\/\/)?(www\.)?(youtube\.com|youtu\.be)\/.+/;
  return pattern.test(url);
};

// Limpeza de arquivos antigos
setInterval(() => {
  const cleanupDir = path.join(__dirname, 'downloads');
  const hour = 3600000;
  fs.readdir(cleanupDir, (err, files) => {
    if (err) return console.error('Erro ao ler diretório:', err.message);
    files.forEach(file => {
      const filePath = path.join(cleanupDir, file);
      const stat = fs.statSync(filePath);
      if (Date.now() - stat.mtimeMs > hour) {
        fs.unlink(filePath, (unlinkErr) => {
          if (unlinkErr) console.error('Erro ao remover arquivo:', unlinkErr.message);
        });
      }
    });
  });
}, 3600000);

// Rota de download
app.post('/api/download', async (req, res) => {
  try {
    const { url, format } = req.body;

    if (!url || !format) {
      return res.status(400).json({ error: 'URL e formato são obrigatórios.' });
    }

    if (!isValidUrl(url)) {
      console.error('URL inválida:', url);
      return res.status(400).json({ error: 'URL do YouTube inválida.' });
    }

    const outputDir = path.join(__dirname, 'downloads');
    if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, { recursive: true });

    // Obter título do vídeo
    const getTitle = `yt-dlp --get-title --no-warnings "${url}"`;
    const title = await new Promise((resolve, reject) => 
      execFile('sh', ['-c', getTitle], (error, stdout) => {
        if (error) {
          console.error('Erro ao obter título:', error.message);
          return reject(error);
        }
        resolve(sanitize(stdout.toString().trim()));
      })
    );

    const filename = `${title}_${Date.now()}.${format}`;
    const filepath = path.join(outputDir, filename);

    let args = [];
    if (format === 'mp3') {
      args = ['-x', '--audio-format', 'mp3', '-o', filepath, url];
    } else if (format === 'mp4') {
      args = ['-f', 'bestvideo[ext=mp4]+bestaudio[ext=m4a]/mp4', '-o', filepath, url];
    } else {
      console.error('Formato não suportado:', format);
      return res.status(400).json({ error: 'Formato não suportado.' });
    }

    execFile('yt-dlp', args, { timeout: 300000 }, (error) => {
      if (error) {
        console.error('Erro ao baixar o vídeo:', error.message);
        return res.status(500).json({ error: 'Falha no download. Verifique o link e tente novamente.' });
      }

      // Enviar o arquivo diretamente ao navegador
      res.download(filepath, filename, (err) => {
        if (err) {
          console.error('Erro ao enviar o arquivo:', err.message);
          return res.status(500).json({ error: 'Erro ao enviar o arquivo.' });
        }
        // Remover o arquivo após o envio
        fs.unlink(filepath, (unlinkErr) => {
          if (unlinkErr) console.error('Erro ao remover o arquivo:', unlinkErr.message);
        });
      });
    });
  } catch (error) {
    console.error('Erro geral:', error.message);
    res.status(500).json({ error: 'Erro interno do servidor.' });
  }
});

app.listen(PORT, () => {
  console.log(`Servidor rodando na porta ${PORT}`);
});