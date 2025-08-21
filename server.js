// server.js - v2
// Servidor ponte atualizado para lidar com múltiplos ativos de commodities
// e permitir que o frontend selecione qual ativo monitorar.

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
let isCedroConnected = false;
let currentSubscribedSymbol = ''; // Armazena o símbolo do ativo que estamos monitorando

console.log('Iniciando o servidor ponte para a API Cedro...');

function connectToCedro() {
    console.log(`Tentando conectar ao servidor da Cedro em ${CEDRO_HOST}:${CEDRO_PORT}...`);
    
    cedroClient = new net.Socket();
    cedroClient.connect(CEDRO_PORT, CEDRO_HOST, () => {
        console.log('>>> Conexão TCP com a Cedro estabelecida com sucesso!');
        const loginMessage = `${CEDRO_USER}\n${CEDRO_PASS}\n`;
        console.log('Enviando credenciais para autenticação...');
        cedroClient.write(loginMessage);
    });

    cedroClient.on('data', (data) => {
        const message = data.toString().trim();
        
        if (!isCedroConnected) {
            if (message.includes('AUTHORIZED') || message.includes('OK') || message.includes('connected')) {
                 console.log('>>> Autenticação na Cedro bem-sucedida!');
                 isCedroConnected = true;
                 // Não se inscreve em nenhum ativo por padrão, aguarda o comando do frontend.
                 broadcast(JSON.stringify({ type: 'auth_success', message: 'Autenticado na Cedro.' }));
            } else {
                console.error('Falha na autenticação da Cedro:', message);
                cedroClient.destroy();
            }
            return;
        }

        // --- PARSING DOS DADOS DE MERCADO ---
        // A documentação da Cedro é crucial aqui.
        // Simulando um formato: "CODIGO_ATIVO|PRECO|..."
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
        isCedroConnected = false;
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
            // O frontend vai enviar um comando para se inscrever em um ativo
            if (command.action === 'subscribe' && command.symbol && isCedroConnected) {
                
                // Se já estiver inscrito em outro ativo, cancela a inscrição anterior
                if (currentSubscribedSymbol && currentSubscribedSymbol !== command.symbol) {
                    console.log(`Cancelando inscrição de ${currentSubscribedSymbol}`);
                    cedroClient.write(`UNSUBSCRIBE|${currentSubscribedSymbol}\n`);
                }

                console.log(`Frontend solicitou inscrição para o ativo: ${command.symbol}`);
                // O comando de inscrição deve ser verificado na documentação. Ex: "SUBSCRIBE|CODIGO"
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
