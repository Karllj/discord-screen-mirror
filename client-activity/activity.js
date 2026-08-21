/**
 * =============================================================================
 * ACTIVITY.JS — Lógica do Receptor (Slave / Discord Activity)
 * =============================================================================
 *
 * FLUXO COMPLETO:
 *
 *  1. Inicializa o Discord Embedded App SDK para autenticar a atividade
 *     e obter o contexto do Discord (usuário, canal, etc).
 *  2. Conecta ao servidor Socket.io.
 *  3. Conecta ao PeerJS Server para obter nosso próprio Peer ID.
 *  4. Pergunta ao servidor se há um transmissor ativo:
 *     a. Se sim: liga imediatamente para o Peer ID do transmissor.
 *     b. Se não: fica aguardando o evento 'broadcaster-available'.
 *  5. Quando a chamada WebRTC é estabelecida, exibe o stream no <video>.
 *  6. Ouve o evento 'stream-ended' para tratar quando o transmissor para.
 *
 * SOBRE O DISCORD SDK:
 *  O DiscordSDK.ready() autoriza a atividade dentro do iframe do Discord,
 *  permitindo autenticação OAuth e acesso a dados do contexto do servidor.
 *  Em desenvolvimento local (fora do iframe), o SDK opera em modo de fallback.
 *
 * =============================================================================
 */

// ---------------------------------------------------------------------------
// CONFIGURAÇÃO
// CLIENT_ID: ID da sua aplicação no Discord Developer Portal.
// SERVER_URL: Endereço do servidor de sinalização.
// ---------------------------------------------------------------------------
const CLIENT_ID = '1540198595985281025'; // ← Substitua pelo ID real
const SERVER_URL = 'https://used-backgrounds-electricity-buy.trycloudflare.com';

// ---------------------------------------------------------------------------
// REFERÊNCIAS AO DOM
// ---------------------------------------------------------------------------
const streamVideo = document.getElementById('stream-video');
const overlay = document.getElementById('overlay');
const overlayIcon = document.getElementById('overlay-icon');
const overlayTitle = document.getElementById('overlay-title');
const overlaySub = document.getElementById('overlay-subtitle');
const statusBadge = document.getElementById('status-badge');
const badgeDot = document.getElementById('badge-dot');
const badgeText = document.getElementById('badge-text');

// ---------------------------------------------------------------------------
// ESTADO DA APLICAÇÃO
// ---------------------------------------------------------------------------
let peer = null;
let socket = null;
let activeCall = null;

// ---------------------------------------------------------------------------
// HELPERS DE UI
// ---------------------------------------------------------------------------
function showOverlay(icon, title, subtitle, iconClass = '') {
  overlay.classList.remove('hidden');
  overlayIcon.textContent = icon;
  overlayIcon.className = `overlay-icon ${iconClass}`;
  overlayTitle.textContent = title;
  overlaySub.textContent = subtitle;
}

function hideOverlay() {
  overlay.classList.add('hidden');
}

function setBadge(text, isLive = false) {
  statusBadge.classList.add('visible');
  badgeText.textContent = text;
  badgeDot.className = `badge-dot ${isLive ? 'live' : ''}`;
}

// ---------------------------------------------------------------------------
// PASSO 1: Inicializa o Discord Embedded App SDK.
//
// O SDK gerencia a comunicação entre o iframe da atividade e o app Discord.
// Quando rodando dentro do iframe, ele intercepta os frames do Discord e
// autentica o usuário automaticamente.
//
// IMPORTANTE: O arquivo @discord/embedded-app-sdk deve ser importado via
// CDN ou bundler. O objeto 'DiscordSDK' fica disponível globalmente.
// ---------------------------------------------------------------------------
async function initDiscordSDK() {
  try {
    // Verifica se o SDK está disponível (pode não estar em teste local)
    if (typeof DiscordSDK === 'undefined') {
      console.warn('[Discord SDK] SDK não encontrado. Rodando em modo standalone.');
      return null;
    }

    const discordSdk = new DiscordSDK(CLIENT_ID);

    showOverlay('🔐', 'Autenticando...', 'Aguardando autorização do Discord');
    console.log('[Discord SDK] Inicializando...');

    // Aguarda o SDK estar pronto (handshake com o iframe do Discord)
    await discordSdk.ready();
    console.log('[Discord SDK] SDK pronto.');

    // Inicia o fluxo de autorização OAuth2 com o Discord
    const { code } = await discordSdk.commands.authorize({
      client_id: CLIENT_ID,
      response_type: 'code',
      state: '',
      prompt: 'none',
      scope: [
        'identify',           // Dados básicos do usuário
        'guilds',             // Servidores do usuário
        'rpc.activities.write', // Permissão para atividades
      ],
    });

    console.log('[Discord SDK] Código de autorização obtido:', code);
    // Em produção, troque o 'code' por um token via seu backend.
    // Exemplo: POST /api/token { code } → access_token

    return discordSdk;
  } catch (err) {
    // Fora do iframe do Discord (desenvolvimento local), o SDK pode falhar.
    // Continuamos em modo standalone.
    console.warn('[Discord SDK] Erro ao inicializar (esperado em modo local):', err.message);
    return null;
  }
}

// ---------------------------------------------------------------------------
// PASSO 2 & 3: Conecta ao Socket.io e ao PeerJS simultaneamente.
// ---------------------------------------------------------------------------
function initConnections() {
  return new Promise((resolve, reject) => {
    // -- Socket.io --
    socket = io(SERVER_URL);

    socket.on('connect', () => {
      console.log('[Socket.io] Conectado:', socket.id);
      setBadge('Conectado');
    });

    socket.on('disconnect', () => {
      console.log('[Socket.io] Desconectado.');
      setBadge('Desconectado');
    });

    // -- PeerJS --
    peer = new Peer({
      host: 'used-backgrounds-electricity-buy.trycloudflare.com',
      port: 443,
      path: '/peerjs',
      secure: true,
      debug: 2,
    });

    peer.on('open', (id) => {
      console.log('[PeerJS] Conectado. Meu Peer ID:', id);
      resolve(); // Ambas as conexões estão prontas
    });

    peer.on('error', (err) => {
      console.error('[PeerJS] Erro:', err);
      reject(err);
    });
  });
}

// ---------------------------------------------------------------------------
// PASSO 5: Recebe e exibe o stream de vídeo.
// Chamado quando o PeerJS estabelece a conexão com o transmissor.
// ---------------------------------------------------------------------------
function handleIncomingStream(remoteStream) {
  console.log('[PeerJS] Stream de vídeo recebido!', remoteStream.getTracks());

  streamVideo.srcObject = remoteStream;
  streamVideo.play().catch(err => {
    // Autoplay pode ser bloqueado pelo browser. Tentamos mudo primeiro.
    console.warn('[Video] Autoplay bloqueado, tentando mudo:', err);
    streamVideo.muted = true;
    streamVideo.play();
  });

  hideOverlay();
  setBadge('AO VIVO', true);
}

// ---------------------------------------------------------------------------
// PASSO 4a: Liga para o transmissor usando o PeerID recebido.
// ---------------------------------------------------------------------------
function callBroadcaster(broadcasterPeerId) {
  console.log('[PeerJS] Ligando para o transmissor:', broadcasterPeerId);
  showOverlay('📞', 'Conectando...', `Estabelecendo conexão com o transmissor`);

  // Criamos uma chamada de vídeo para o transmissor.
  // Passamos null como stream pois somos apenas receptores (não enviamos nada).
  const call = peer.call(broadcasterPeerId, null, {
    // Opcional: metadados para o transmissor identificar este receptor
    metadata: { role: 'viewer', id: peer.id },
  });

  activeCall = call;

  // Recebemos o stream do transmissor
  call.on('stream', (remoteStream) => {
    handleIncomingStream(remoteStream);
  });

  call.on('close', () => {
    console.log('[PeerJS] Chamada encerrada pelo transmissor.');
    activeCall = null;
    showOverlay('⏸️', 'Stream Encerrado', 'O transmissor parou de compartilhar a tela.', 'stopped');
    setBadge('Encerrado');
    streamVideo.srcObject = null;
  });

  call.on('error', (err) => {
    console.error('[PeerJS] Erro na chamada:', err);
    showOverlay('❌', 'Erro de Conexão', err.message, 'stopped');
  });
}

// ---------------------------------------------------------------------------
// EVENTO: broadcaster-available
// O servidor nos avisa que há um transmissor e envia o PeerID dele.
// Isso acontece quando:
//  - Chegamos e já havia transmissor (resposta do 'request-broadcaster-id')
//  - O transmissor inicia após nossa chegada (broadcast do servidor)
// ---------------------------------------------------------------------------
function setupSocketEvents() {
  socket.on('broadcaster-available', (broadcasterPeerId) => {
    console.log('[Socket.io] Transmissor disponível! PeerID:', broadcasterPeerId);
    callBroadcaster(broadcasterPeerId);
  });

  socket.on('no-broadcaster', () => {
    console.log('[Socket.io] Nenhum transmissor ativo no momento.');
    showOverlay('📺', 'Aguardando Transmissor', 'Abra a página de captura e clique em "Compartilhar Tela"', 'stopped');
    setBadge('Aguardando');
  });

  // ---------------------------------------------------------------------------
  // EVENTO: stream-ended
  // O transmissor parou o compartilhamento de tela.
  // ---------------------------------------------------------------------------
  socket.on('stream-ended', () => {
    console.log('[Socket.io] Transmissor encerrou o stream.');
    if (activeCall) {
      activeCall.close();
      activeCall = null;
    }
    streamVideo.srcObject = null;
    showOverlay('⏸️', 'Transmissão Encerrada', 'O transmissor parou de compartilhar a tela.', 'stopped');
    setBadge('Encerrado');
  });
}

// ---------------------------------------------------------------------------
// FUNÇÃO PRINCIPAL — orquestra toda a inicialização
// ---------------------------------------------------------------------------
async function main() {
  showOverlay('⚙️', 'Inicializando...', 'Conectando ao servidor de sinalização');

  try {
    // Passo 1: Discord SDK (não bloqueante, pode falhar em modo local)
    await initDiscordSDK();

    // Passo 2 & 3: Socket.io + PeerJS
    showOverlay('🔌', 'Conectando...', 'Estabelecendo conexão com o servidor');
    await initConnections();

    // Passo 4: Registra os listeners de Socket.io
    setupSocketEvents();

    // Passo 4: Pergunta ao servidor se já existe um transmissor ativo
    showOverlay('📡', 'Aguardando Transmissor', 'Verificando se há uma transmissão ativa...');
    socket.emit('request-broadcaster-id');

    console.log('[App] Receptor inicializado com sucesso. Aguardando transmissor...');

  } catch (err) {
    console.error('[App] Erro fatal durante inicialização:', err);
    showOverlay('❌', 'Erro Fatal', `Não foi possível conectar: ${err.message}`, 'stopped');
  }
}

// ---------------------------------------------------------------------------
// Inicia tudo quando o DOM estiver pronto
// ---------------------------------------------------------------------------
document.addEventListener('DOMContentLoaded', main);
