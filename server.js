// server.js - v3
// Servidor ponte com lógica de autenticação corrigida.
// Agora ele aguarda a mensagem de boas-vindas do servidor antes de enviar o login.

const express = require('express');
const http = require('http');
const net = require('net');
const WebSocket = require('ws');

// --- CONFIGURAÇÕES DA CEDRO ---
const CEDRO_HOST = 'datafeed1.cedrotech.com';
const CEDRO_PORT = 81;
const CEDRO_USER = 'victor-socket';
const CEDRO_PASS = 'socket178';
// ------------------------------

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

let cedroClient = new net.Socket();
let isAuthenticated = false;
let hasSentLogin = false; // Novo: Controla se já enviamos o comando de login
let currentSubscribedSymbol = '';

console.log('Iniciando o servidor ponte para a API Cedro...');

function connectToCedro() {
    console.log(`Tentando conectar ao servidor da Cedro em ${CEDRO_HOST}:${CEDRO_PORT}...`);
    
    cedroClient = new net.Socket();
    // Reseta o estado da conexão
    isAuthenticated = false;
    hasSentLogin = false;

    cedroClient.connect(CEDRO_PORT, CEDRO_HOST, () => {
        console.log('>>> Conexão TCP com a Cedro estabelecida com sucesso!');
        // Correção: Não envia o login imediatamente. Aguarda a mensagem do servidor.
    });

    cedroClient.on('data', (data) => {
        const message = data.toString().trim();
        // Novo: Log para vermos TUDO que a Cedro envia
        console.log(`[CEDRO RAW]: ${message}`);

        // Etapa 1: Receber a mensagem de boas-vindas e enviar o login
        if (!hasSentLogin) {
            // A mensagem que vimos no log era "Connecting..."
            if (message.includes('Connecting...')) {
                console.log('Recebida mensagem de boas-vindas. Enviando credenciais...');
                // Correção: Tenta um formato de login mais explícito.
                // Este formato precisa ser confirmado pela documentação oficial.
                const loginMessage = `LOGIN ${CEDRO_USER} ${CEDRO_PASS}\n`; 
                cedroClient.write(loginMessage);
                hasSentLogin = true;
            } else {
                console.log('Mensagem inesperada recebida antes do login. Fechando conexão.');
                cedroClient.destroy();
            }
            return;
        }

        // Etapa 2: Após enviar o login, aguardar a confirmação de autenticação
        if (!isAuthenticated) {
            // A documentação deve dizer qual é a mensagem de sucesso. Ex: "OK", "AUTHORIZED"
            if (message.includes('OK') || message.includes('AUTHORIZED') || message.includes('Login successful')) {
                 console.log('>>> Autenticação na Cedro bem-sucedida!');
                 isAuthenticated = true;
                 broadcast(JSON.stringify({ type: 'auth_success', message: 'Autenticado na Cedro.' }));
            } else {
                console.error('Falha na autenticação da Cedro. Resposta:', message);
                cedroClient.destroy(); // Encerra a conexão se a autenticação falhar
            }
            return;
        }

        // Etapa 3: Se já estiver autenticado, processar os dados de mercado
        const parts = message.split('|');
        const symbol = parts[0];
        const price = parseFloat(parts[1]?.replace(',', '.'));

        if (symbol === currentSubscribedSymbol && !isNaN(price)) {
            const dataToSend = {
                type: 'tick',
                symbol: symbol,
                price: price,
                timestamp: Date.now()
            };
            broadcast(JSON.stringify(dataToSend));
        }
    });

    cedroClient.on('close', () => {
        console.log('!!! Conexão com a Cedro foi fechada. Tentando reconectar em 5 segundos...');
        isAuthenticated = false;
        hasSentLogin = false;
        currentSubscribedSymbol = '';
        broadcast(JSON.stringify({ type: 'cedro_disconnected' }));
        setTimeout(connectToCedro, 5000);
    });

    cedroClient.on('error', (err) => {
        console.error('### Erro na conexão com a Cedro:', err.message);
    });
}

// Função para enviar dados para todos os clientes (navegadores)
function broadcast(data) {
    wss.clients.forEach(client => {
        if (client.readyState === WebSocket.OPEN) {
            client.send(data);
        }
    });
}

// Lida com mensagens vindas do frontend
wss.on('connection', ws => {
    console.log('Novo cliente (navegador) conectado.');

    ws.on('message', message => {
        try {
            const command = JSON.parse(message);
            if (command.action === 'subscribe' && command.symbol && isAuthenticated) {
                if (currentSubscribedSymbol && currentSubscribedSymbol !== command.symbol) {
                    console.log(`Cancelando inscrição de ${currentSubscribedSymbol}`);
                    cedroClient.write(`UNSUBSCRIBE|${currentSubscribedSymbol}\n`);
                }
                console.log(`Frontend solicitou inscrição para o ativo: ${command.symbol}`);
                cedroClient.write(`SUBSCRIBE|${command.symbol}\n`);
                currentSubscribedSymbol = command.symbol;
            }
        } catch (e) {
            console.error('Erro ao processar mensagem do cliente:', e);
        }
    });

    ws.on('close', () => {
        console.log('Cliente (navegador) desconectado.');
    });
});

// Inicia a conexão
connectToCedro();

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`--- Servidor WebSocket rodando na porta ${PORT} ---`);
});
