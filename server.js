// server.js - v4
// Lógica de autenticação corrigida para o fluxo interativo (Username -> Password).

const express = require('express');
const http = require('http');
const net = require('net');
const WebSocket = require('ws');

// --- CONFIGURAÇÕES DA CEDRO ---
const CEDRO_HOST = 'datafeed1.cedrotech.com';
const CEDRO_PORT = 81;
const CEDRO_USER = 'victor-socket';
const CEDRO_PASS = 'socket1 ৭৮';
// ------------------------------

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

let cedroClient = new net.Socket();
let isAuthenticated = false;
// Novo: Controla as etapas da autenticação
let authStep = 0; // 0: Esperando Username, 1: Esperando Password, 2: Autenticado
let currentSubscribedSymbol = '';

console.log('Iniciando o servidor ponte para a API Cedro...');

function connectToCedro() {
    console.log(`Tentando conectar ao servidor da Cedro em ${CEDRO_HOST}:${CEDRO_PORT}...`);
    
    cedroClient = new net.Socket();
    isAuthenticated = false;
    authStep = 0;

    cedroClient.connect(CEDRO_PORT, CEDRO_HOST, () => {
        console.log('>>> Conexão TCP com a Cedro estabelecida com sucesso!');
    });

    cedroClient.on('data', (data) => {
        const message = data.toString().trim();
        console.log(`[CEDRO RAW]: ${message}`);

        // Se já estiver autenticado, processa os dados de mercado
        if (isAuthenticated) {
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
            return;
        }

        // --- LÓGICA DE AUTENTICAÇÃO PASSO A PASSO ---
        
        // Etapa 0: Servidor pede o "Username"
        if (authStep === 0 && message.includes('Username:')) {
            console.log('Servidor solicitou Username. Enviando...');
            cedroClient.write(`${CEDRO_USER}\n`);
            authStep = 1; // Avança para a próxima etapa
            return;
        }

        // Etapa 1: Servidor pede o "Password"
        if (authStep === 1 && message.includes('Password:')) {
            console.log('Servidor solicitou Password. Enviando...');
            cedroClient.write(`${CEDRO_PASS}\n`);
            authStep = 2; // Avança para a próxima etapa
            return;
        }

        // Etapa 2: Servidor confirma o login
        if (authStep === 2) {
            if (message.includes('OK') || message.includes('successful') || message.includes('AUTHORIZED')) {
                console.log('>>> AUTENTICAÇÃO NA CEDRO BEM-SUCEDIDA!');
                isAuthenticated = true;
                broadcast(JSON.stringify({ type: 'auth_success', message: 'Autenticado na Cedro.' }));
            } else {
                console.error('Falha na autenticação da Cedro. Resposta final:', message);
                cedroClient.destroy();
            }
            return;
        }
    });

    cedroClient.on('close', () => {
        console.log('!!! Conexão com a Cedro foi fechada. Tentando reconectar em 5 segundos...');
        isAuthenticated = false;
        authStep = 0;
        currentSubscribedSymbol = '';
        broadcast(JSON.stringify({ type: 'cedro_disconnected' }));
        setTimeout(connectToCedro, 5000);
    });

    cedroClient.on('error', (err) => {
        console.error('### Erro na conexão com a Cedro:', err.message);
    });
}

function broadcast(data) {
    wss.clients.forEach(client => {
        if (client.readyState === WebSocket.OPEN) {
            client.send(data);
        }
    });
}

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

connectToCedro();

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`--- Servidor WebSocket rodando na porta ${PORT} ---`);
});
