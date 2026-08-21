/**
 * =============================================================================
 * CAPTURE.JS — Lógica do Transmissor (Master)
 * =============================================================================
 *
 * FLUXO COMPLETO:
 *
 *  1. Ao carregar a página, conectamos ao servidor Socket.io e ao PeerJS.
 *  2. O PeerJS nos fornece um ID único (Peer ID).
 *  3. Quando o usuário clica em "Compartilhar Tela":
 *     a. Chamamos navigator.mediaDevices.getDisplayMedia() → obtem o stream.
 *     b. Exibimos o stream no <video> local (preview mudo).
 *     c. Enviamos o Peer ID ao servidor via Socket.io (evento 'broadcaster-ready').
 *  4. O servidor retransmite o Peer ID para os receptores (broadcast).
 *  5. Cada receptor liga para o nosso Peer ID via PeerJS.
 *  6. Respondemos às chamadas entrantes com o nosso stream de tela.
 *  7. Quando o usuário para, encerramos o stream e avisamos via Socket.io.
 *
 * =============================================================================
 */

// ---------------------------------------------------------------------------
// CONFIGURAÇÃO
// Altere SERVER_URL para o endereço do seu servidor em produção.
// ---------------------------------------------------------------------------
const SERVER_URL = 'https://used-backgrounds-electricity-buy.trycloudflare.com';

// ---------------------------------------------------------------------------
// ESTADO DA APLICAÇÃO
// ---------------------------------------------------------------------------
let localStream = null;       // O MediaStream capturado da tela
let peer = null;              // Instância do PeerJS (nosso "telefone")
let socket = null;            // Instância do Socket.io
let activeCalls = [];         // Lista de chamadas ativas (pode haver múltiplos receptores)

// ---------------------------------------------------------------------------
// REFERÊNCIAS AO DOM
// ---------------------------------------------------------------------------
const previewVideo = document.getElementById('preview');
const placeholder = document.getElementById('placeholder');
const btnShare = document.getElementById('btn-share');
const btnStop = document.getElementById('btn-stop');
const dotSocket = document.getElementById('dot-socket');
const dotPeer = document.getElementById('dot-peer');
const dotStream = document.getElementById('dot-stream');
const statusSocket = document.getElementById('status-socket');
const statusPeer = document.getElementById('status-peer');
const statusStream = document.getElementById('status-stream');
const peerIdBox = document.getElementById('peer-id-box');

// ---------------------------------------------------------------------------
// HELPERS DE UI
// ---------------------------------------------------------------------------
function setStatus(dot, label, text, state) {
  dot.className = `dot ${state}`;
  label.textContent = text;
}

function showPreview(stream) {
  previewVideo.srcObject = stream;
  previewVideo.style.display = 'block';
  placeholder.style.display = 'none';
}

function hidePreview() {
  previewVideo.srcObject = null;
  previewVideo.style.display = 'none';
  placeholder.style.display = 'flex';
}

// ---------------------------------------------------------------------------
// PASSO 1: Inicializa a conexão Socket.io com o servidor de controle.
// Socket.io gerencia os eventos de aplicação (quem está transmitindo, etc).
// ---------------------------------------------------------------------------
function initSocket() {
  socket = io(SERVER_URL);

  socket.on('connect', () => {
    setStatus(dotSocket, statusSocket, `Conectado (${socket.id.slice(0, 8)}...)`, 'connected');
    console.log('[Socket.io] Conectado ao servidor:', socket.id);
  });

  socket.on('disconnect', () => {
    setStatus(dotSocket, statusSocket, 'Desconectado', 'error');
    console.warn('[Socket.io] Desconectado do servidor.');
  });

  socket.on('connect_error', (err) => {
    setStatus(dotSocket, statusSocket, 'Erro de conexão', 'error');
    console.error('[Socket.io] Erro:', err.message);
  });
}

// ---------------------------------------------------------------------------
// PASSO 2: Inicializa o cliente PeerJS.
// O PeerJS cuida de todo o protocolo WebRTC (ICE, SDP, STUN/TURN).
// Ao se conectar ao PeerJS Server, recebemos um ID único.
// ---------------------------------------------------------------------------
function initPeer() {
  peer = new Peer({
    host: 'used-backgrounds-electricity-buy.trycloudflare.com',
    port: 443,
    path: '/peerjs',
    secure: true,
    debug: 2,
  });

  // Recebemos nosso ID do servidor PeerJS
  peer.on('open', (id) => {
    setStatus(dotPeer, statusPeer, `ID: ${id.slice(0, 12)}...`, 'connected');
    peerIdBox.textContent = `Peer ID: ${id}`;
    peerIdBox.style.display = 'block';
    console.log('[PeerJS] Conectado. Meu Peer ID:', id);
    btnShare.disabled = false;
  });

  // ---------------------------------------------------------------------------
  // PASSO 6: Respondemos chamadas entrantes dos receptores.
  // Quando um receptor discar para nós, este evento é disparado.
  // Respondemos com o nosso stream de tela capturada (localStream).
  // ---------------------------------------------------------------------------
  peer.on('call', (call) => {
    console.log('[PeerJS] Receptor chamando. Respondendo com o stream de tela...');

    if (!localStream) {
      console.warn('[PeerJS] Chamada recebida, mas não há stream ativo. Ignorando.');
      return;
    }

    // Atendemos a chamada enviando nosso stream de tela
    call.answer(localStream);
    activeCalls.push(call);

    call.on('close', () => {
      console.log('[PeerJS] Receptor desconectou.');
      activeCalls = activeCalls.filter(c => c !== call);
    });

    call.on('error', (err) => {
      console.error('[PeerJS] Erro na chamada:', err);
    });
  });

  peer.on('error', (err) => {
    setStatus(dotPeer, statusPeer, `Erro: ${err.type}`, 'error');
    console.error('[PeerJS] Erro:', err);
  });

  peer.on('disconnected', () => {
    setStatus(dotPeer, statusPeer, 'Desconectado', 'error');
    console.warn('[PeerJS] PeerJS desconectou.');
  });
}

// ---------------------------------------------------------------------------
// PASSO 3: Captura a tela do usuário usando a API de Screen Capture.
// getDisplayMedia() abre o seletor nativo do SO para o usuário escolher
// qual janela, aba ou monitor deseja compartilhar.
// ---------------------------------------------------------------------------
async function startCapture() {
  try {
    console.log('[Capture] Solicitando acesso à tela...');

    localStream = await navigator.mediaDevices.getDisplayMedia({
      video: {
        width: { ideal: 1920 },
        height: { ideal: 1080 },
        frameRate: { ideal: 30, max: 60 },
        cursor: 'always', // Inclui o cursor do mouse na captura
      },
      audio: false, // Áudio do sistema pode ser habilitado com true
    });

    console.log('[Capture] Stream obtido:', localStream.getTracks());

    // Exibe o preview local (mudo para evitar eco)
    showPreview(localStream);

    setStatus(dotStream, statusStream, 'Transmitindo', 'streaming');
    btnShare.style.display = 'none';
    btnStop.style.display = 'flex';

    // ---------------------------------------------------------------------------
    // PASSO 3c: Anuncia nossa disponibilidade via Socket.io.
    // Enviamos nosso PeerID para o servidor, que o retransmitirá para
    // todos os receptores conectados.
    // ---------------------------------------------------------------------------
    socket.emit('broadcaster-ready', peer.id);
    console.log('[Socket.io] Anunciando PeerID:', peer.id);

    // Detecta quando o usuário para o compartilhamento pelo botão nativo do browser
    localStream.getVideoTracks()[0].addEventListener('ended', () => {
      console.log('[Capture] Stream encerrado pelo usuário (botão nativo).');
      stopCapture();
    });

  } catch (err) {
    console.error('[Capture] Erro ao capturar tela:', err);
    if (err.name === 'NotAllowedError') {
      alert('Permissão negada. Por favor, permita o compartilhamento de tela.');
    } else {
      alert(`Erro ao iniciar captura: ${err.message}`);
    }
  }
}

// ---------------------------------------------------------------------------
// PASSO 7: Para a transmissão e avisa todos os receptores.
// ---------------------------------------------------------------------------
function stopCapture() {
  if (localStream) {
    // Para todas as tracks do stream (encerra o compartilhamento de tela)
    localStream.getTracks().forEach(track => track.stop());
    localStream = null;
  }

  // Encerra todas as chamadas ativas com receptores
  activeCalls.forEach(call => call.close());
  activeCalls = [];

  // Avisa o servidor que o stream acabou (que avisará os receptores)
  if (socket && socket.connected) {
    socket.emit('broadcaster-stopped');
  }

  hidePreview();
  setStatus(dotStream, statusStream, 'Inativo', '');
  btnShare.style.display = 'flex';
  btnStop.style.display = 'none';

  console.log('[Capture] Transmissão encerrada.');
}

// ---------------------------------------------------------------------------
// EVENT LISTENERS dos botões
// ---------------------------------------------------------------------------
btnShare.addEventListener('click', startCapture);
btnStop.addEventListener('click', stopCapture);

// ---------------------------------------------------------------------------
// INICIALIZAÇÃO
// Conecta ao servidor assim que a página carrega.
// ---------------------------------------------------------------------------
btnShare.disabled = true; // Desabilitado até o PeerJS conectar

initSocket();
initPeer();

console.log('[App] Página transmissora inicializada. Aguardando conexão...');
