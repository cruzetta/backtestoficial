// server.js - v12 (Solução Definitiva)
// Implementa o protocolo de autenticação completo da Cedro, incluindo o passo da "Software Key".

const express = require('express');
const http = require('http');
const net = require('net');
const WebSocket = require('ws');

// --- CONFIGURAÇÕES DA CEDRO ---
const CEDRO_SERVERS = [
    { host: 'datafeed1.cedrotech.com', port: 81 },
    { host: 'datafeed2.cedrotech.com', port: 81 }
];
const CEDRO_USER = 'victor-socket';
const CEDRO_PASS = 'socket178';
// ------------------------------

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

let cedroClient = new net.Socket();
let isAuthenticated = false;
// Controla as etapas da autenticação:
// 0: Aguardando prompt inicial (Software Key)
// 1: Aguardando prompt de Username
// 2: Aguardando prompt de Password
// 3: Aguardando confirmação final
let authStep = 0; 
let currentSubscribedSymbol = '';
let currentServerIndex = 0;

console.log('Iniciando o servidor ponte para a API Cedro...');

function connectToCedro() {
    const serverConfig = CEDRO_SERVERS[currentServerIndex];
    console.log(`Tentando conectar ao servidor da Cedro em ${serverConfig.host}:${serverConfig.port}...`);
    
    cedroClient = new net.Socket();
    isAuthenticated = false;
    authStep = 0;

    cedroClient.connect(serverConfig.port, serverConfig.host, () => {
        console.log(`>>> Conexão TCP com ${serverConfig.host} estabelecida com sucesso!`);
    });

    cedroClient.on('data', (data) => {
        const messages = data.toString().trim().split(/[\r\n]+/).filter(m => m);
        
        messages.forEach(message => {
            console.log(`[CEDRO RAW]: ${message}`);

            if (isAuthenticated) {
                const parts = message.split('|');
                const symbol = parts[0];
                const price = parseFloat(parts[1]?.replace(',', '.'));

                if (symbol === currentSubscribedSymbol && !isNaN(price)) {
                    const dataToSend = { type: 'tick', symbol, price, timestamp: Date.now() };
                    broadcast(JSON.stringify(dataToSend));
                }
                return;
            }

            // --- LÓGICA DE AUTENTICAÇÃO DEFINITIVA (COM SOFTWARE KEY) ---
            
            // Etapa 0: O servidor envia o banner inicial. Respondemos com a "Software Key" vazia.
            if (authStep === 0) {
                console.log('Recebido prompt inicial. Enviando Software Key (vazia)...');
                // Enviar uma linha em branco é o equivalente a pressionar Enter.
                cedroClient.write('\n'); 
                authStep = 1; // Avança para a próxima etapa
                return;
            }

            // Etapa 1: Espera pelo prompt "Username:"
            if (authStep === 1 && message.includes('Username:')) {
                console.log('Servidor solicitou Username. Enviando...');
                cedroClient.write(`${CEDRO_USER}\n`);
                authStep = 2;
                return;
            }

            // Etapa 2: Espera pelo prompt "Password:"
            if (authStep === 2 && message.includes('Password:')) {
                console.log('Servidor solicitou Password. Enviando...');
                cedroClient.write(`${CEDRO_PASS}\n`);
                authStep = 3;
                return;
            }

            // Etapa 3: Espera pela confirmação final do login
            if (authStep === 3) {
                if (message.includes('OK') || message.includes('successful') || message.includes('AUTHORIZED')) {
                    console.log('>>> AUTENTICAÇÃO NA CEDRO BEM-SUCEDIDA!');
                    isAuthenticated = true;
                    authStep = 4; // Autenticação concluída
                    broadcast(JSON.stringify({ type: 'auth_success', message: 'Autenticado na Cedro.' }));
                } else if (message.includes('failed') || message.includes('Invalid')) {
                    console.error('Falha na autenticação da Cedro. Resposta final:', message);
                    cedroClient.destroy();
                }
                return;
            }
        });
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
        console.error(`### Erro na conexão com ${serverConfig.host}: ${err.message}`);
        currentServerIndex = (currentServerIndex + 1) % CEDRO_SERVERS.length;
        console.log(`Alternando para o próximo servidor: ${CEDRO_SERVERS[currentServerIndex].host}`);
        cedroClient.destroy();
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
