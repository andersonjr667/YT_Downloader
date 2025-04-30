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

// Configurações de segurança melhoradas
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

// Servir arquivos estáticos do diretório 'public'
app.use(express.static(path.join(__dirname, 'public')));

// Rota para servir o index.html como padrão
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Validação de URL melhorada
const isValidUrl = (url) => {
  const pattern = /^(https?:\/\/)?(www\.)?(youtube\.com|youtu\.be)\/.+/;
  return pattern.test(url);
};

// Limpeza de arquivos antigos
setInterval(() => {
  const cleanupDir = path.join(__dirname, 'downloads');
  const hour = 3600000;
  fs.readdir(cleanupDir, (err, files) => {
    if (err) return console.error(err);
    files.forEach(file => {
      const filePath = path.join(cleanupDir, file);
      const stat = fs.statSync(filePath);
      if (Date.now() - stat.mtimeMs > hour) {
        fs.unlinkSync(filePath);
      }
    });
  });
}, 3600000);

app.post('/api/download', async (req, res) => {
  try {
    const { url, format } = req.body;
    
    if (!isValidUrl(url)) {
      return res.status(400).json({ error: 'URL do YouTube inválida' });
    }

    const outputDir = path.join(__dirname, 'downloads');
    if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, { recursive: true });

    // Obter título do vídeo para nome do arquivo
    const getTitle = `yt-dlp --get-title --no-warnings "${url}"`;
    const title = await new Promise((resolve, reject) => 
      execFile('sh', ['-c', getTitle], (error, stdout) => {
        if (error) return reject(error);
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
      return res.status(400).json({ error: 'Formato não suportado' });
    }

    execFile('yt-dlp', args, { timeout: 300000 }, (error) => {
      if (error) {
        console.error(`Erro: ${error.message}`);
        return res.status(500).json({ error: 'Falha no download. Verifique o link e tente novamente.' });
      }

      // Enviar o arquivo diretamente ao navegador
      res.download(filepath, filename, (err) => {
        if (err) {
          console.error('Erro ao enviar o arquivo:', err);
          res.status(500).json({ error: 'Erro ao enviar o arquivo.' });
        }
        // Remover o arquivo após o envio
        fs.unlink(filepath, (unlinkErr) => {
          if (unlinkErr) console.error('Erro ao remover o arquivo:', unlinkErr);
        });
      });
    });
  } catch (error) {
    console.error('Erro geral:', error);
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
});

app.listen(PORT, () => {
  console.log(`Servidor rodando na porta ${PORT}`);
});