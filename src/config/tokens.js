// src/config/tokens.js — mapa COMPLETO + fallback dinâmico
const FA_MAP = {
  '0x1::supra_coin::SupraCoin': { symbol: 'SUPRA', decimals: 8 },
  '0x4b28b64c9fa2e5a10f8fb57f1df741f40f58d1eafcfb6ae7c6cfbc68c83d32f7': { symbol: 'LUCKY', decimals: 8 },
  '0xbb3c1ca1ef67b1a994f2463978695c7bf890710182f75edef05ad08490be3658': { symbol: 'JOSH', decimals: 8 },
  '0x80f0251b74c76f1c477b9209ade65ffb5cfecd9b259875c3865ad645f6c33a3d': { symbol: 'DAWGZ', decimals: 8 },
  '0xf90b4b9d4a9d87c39fb3140513e52edc3ead5eaddcb9881b02becdeb63c5793d': { symbol: 'dexUSDC', decimals: 8 },
  '0x90a8e901e02ac1539af4a865bbe4a6b96edc27375488803cfbbd6875ec57b281': { symbol: 'MUMMY', decimals: 8 },
  '0x7b66011900be87269647b5cce4902a04d3189982ae677a393b2046e55c92042': { symbol: 'SPIKE', decimals: 8 },
  '0x98e458ccc04ee5a5de8d82857476f820a033bede08f7fbf033390cea937c6ec6': { symbol: 'LEO', decimals: 8 },
  '0xe583ee359a571682c463c33635044712ad720b0fc59be327235abde4eacf98f7': { symbol: 'MCB', decimals: 8 },
  '0x7b6463ca7a54ee37e113c8333db9c0af49de39555ee1cb44837db4c085f8964': { symbol: 'PECKY', decimals: 8 },
  '0xe1afaaed7625f0a500fc42adb440bd999b7249a0c96e48c4a3f11bc30c211d8': { symbol: 'CASH', decimals: 8 },
  '0xa387de3ef742f9bbf00e8d9d3fe6ef2f4fa549036a8d29db8432d50edb463f41': { symbol: 'REPANDA', decimals: 8 },
  '0x1a290d95d7d2f934bd76f58fa5c3d29612fab9aa9bba00283e67abc26543b00a': { symbol: 'LOWCAPS', decimals: 8 },
  '0x459b5670239b5ddf864138012df750d0e5210628e299a48e4d94f75711e82fc3': { symbol: 'WABBIT', decimals: 8 },
  '0x9d998eff3c742a24139590c57d02ff43a4e536a66bb415edabca6979f081bf1': { symbol: 'TSUPRA', decimals: 8 },
  '0xf0ab0c3c9ab3abf0596dee7713d453096b538a76bdf3b69b0bb271558b40ae52': { symbol: 'BABYJOSH', decimals: 8 },
  '0x99f84c4fda663bf3baf3a1b0980386ca084c3e9340a4d3f8713cd54ec85f4cea': { symbol: 'NANA', decimals: 8 },
  '0xe4af154ade9551e7f58a23b8f727ae2dca050f1b74582bb518ba361c889d246d': { symbol: 'OG', decimals: 8 },
  '0xaa925a2232144c11dfe855178e1d252a8d0d4f51f5572fc0ec34efa6333952ae': { symbol: 'SBC', decimals: 8 },
  '0x870900b6557795114cb154a747400eb5a683d1cc6c9a1f5a0af318f7cf57bf67': { symbol: 'SUPDOG', decimals: 8 },
  '0xf199782bff16646c43de02fe1ca4244def5ea7abe0796a4f45002795e6f6ca35': { symbol: 'ROBBIE', decimals: 8 },
  '0xcc0891286f5df62496390cda6cd0d769cd480667eed04d918be4f9bf3ae96b1d': { symbol: 'PUMP', decimals: 8 },
  '0xb9a4b9082fd9d6bd04987bc0b4676a1c192b3d06daef7b4387ce4e28f12960eb': { symbol: 'SHILLBIL', decimals: 8 },
  '0x1cc2bc27c5134ffcdd80fddcfaa1b9a05f6c03649c9927429f95fc723174c0ae': { symbol: 'FLP', decimals: 8 },
  '0xceff14089bde0d4f512dcd3b6f3df6794346c58115b8d97e043f92ff08cd1fca': { symbol: 'SUPD', decimals: 8 },
  '0x9ffbff160e048e16ed4b9fed27c0b004bfc6b163373793b7f1c4d63b237fe85f': { symbol: 'STC', decimals: 8 },
  '0x7a0f856397582bc65dca11134c9711572612b427837f9ce87cb0bad38a401339': { symbol: 'FA:7A0F', decimals: 8 },
  '0xa96cc508912f1a2f1c254038ea9ffd54707b04cf07d64280fc0081202fb84648': { symbol: 'FA:A96C', decimals: 8 },
  '0x77076e706585f7645c722bc5d7362c0d67100431f585a997270e85f8b856d644': { symbol: 'FA:7707', decimals: 8 },
  '0xf11aa44964cfa8396f6519b54cb212915477cfb792c6451a5d79dc6df352e908': { symbol: 'FA:F11A', decimals: 8 },
  '0x9eb5143f5d5e5f2aa02ffa560cdd98a32eb8d8522883a064d1291d8bff6789a7': { symbol: 'FA:9EB5', decimals: 8 },
  '0xad3d1582b38b2998c71ce145f4fd4b08fadd3a27e21b6967344b56fca038e215': { symbol: 'FA:AD3D', decimals: 8 },
  '0x927e5d470d8bb2054d67e2ffad2952075a7b83cd216ac558564e9c0fe471af4e': { symbol: 'FA:927E', decimals: 8 },
  '0xf4fc8a0ffac72c0d1df07d192fb5806bbccd799c879781404b55e7688eb6b61d': { symbol: 'FA:F4FC', decimals: 8 },
  '0x73f4acd4a079f10ffb3a7b628c19e9231ed09b4742d69c5706869fcd5edfa2cb': { symbol: 'FA:73F4', decimals: 8 },
  '0x2e8512e4a6e47b1ab9bbcef054e5d130b843e70c8179b3eab6c56c393c7d4117': { symbol: 'FA:2E85', decimals: 8 },
  '0xcf8c5fefae3717b488df10f2a6f7f9deb5a016c7b71fafc150234ce1d1a717e': { symbol: 'FA:CF8C', decimals: 8 },
  '0x166f648422165151fa1bd48124bb4ccce8f6c7932728a633d43bffacf30c895': { symbol: 'FA:166F', decimals: 8 },
  '0xa0040c97616048b6e0409e048d5f3cb9cfa0caa91dce0505390ac7ec8a132a86': { symbol: 'FA:A004', decimals: 8 },
  '0xcef22ecc2e7b480f38000d6e78e3b0e6f4de12ea190e0893a9adbcc4599c06a0': { symbol: 'FA:CEF2', decimals: 8 },
  '0xacdc9106c5595a6d23158d39ba57f33ee37dc4d3523729d83e3f0d232d3d6851': { symbol: 'FA:ACDC', decimals: 8 },
  '0xcd8c3998d58cb9818fd4f6892b9d04c9759aa4d378b9f5d4ab6ffe27b956756c': { symbol: 'FA:CD8C', decimals: 8 },
  '0x11188bb79cd956ab6b8ddff06d64f479358b59ddbd2058a41b447cdf21c17ab0': { symbol: 'FA:1118', decimals: 8 },
  '0x2a0f3e6fb5d0f25c0d75cc4ffb93ace26757939fd4aa497c7f1dbaff7e3c6358': { symbol: 'FA:2A0F', decimals: 8 },
  '0x160af172e715ba8440e094b64c1957854bfea569c67f8d9f1e71f8ae6d95108c': { symbol: 'FA:160A', decimals: 8 },
  '0xde3bea1ea2226ebd14000d15fd2fe1814e08fcb6529cee956cc891b799b007f': { symbol: 'FA:DE3B', decimals: 8 },
  '0xb364044ae268b711da93abe55ac1635246a1e9b3cb37df4ce021ed0fe40b165e': { symbol: 'FA:B364', decimals: 8 },
  '0xad335af35686239fded1de8619b030b64a0c3af2d170445a1dcd7010a63b80e6': { symbol: 'FA:AD33', decimals: 8 },
  '0x82ed1f483b5fc4ad105cef5330e480136d58156c30dc70cd2b9c342981997cee': { symbol: 'FA:82ED', decimals: 8 },
  '0x492426412135ce55b9c0e3389cbb62569e7192cd5a15963bf00c96cd9d1c578d': { symbol: 'FA:4924', decimals: 8 },
  '0xe8e41d96f7339899f612fb04c1fd9fa09016b1bc356512f49cf8ba6d7c867148': { symbol: 'FA:E8E4', decimals: 8 },
  '0xe53c911559a7c37186d74c4c9b9582910b4cf1be69f1b0fa45cfd4edf8cc1285': { symbol: 'FA:E53C', decimals: 8 },
  '0x74b2bb134c271773f31c2a203a3f4bc1507971a24cf3d74ad14883e00f86a230': { symbol: 'FA:74B2', decimals: 8 },
  '0xb4e1dc6921fc96c9509929b1b6fc4948974fbb465d5cafa06ce60b55b879ad9': { symbol: 'FA:B4E1', decimals: 8 },
  '0xd7908e3916c2787239114d6eb634380ff60458f9ee7212e46ac0d37e673be851': { symbol: 'SOUP', decimals: 8 },
  '0xb255b3bd7e04771feb89db424ab4814fd85d70b8a03230bff9998e73e161f82': { symbol: 'FA:B255', decimals: 8 },
  '0x17315a4d9344f9ffba7fa237b895cddd7ce829b5f9d613ca987941c2b48bdbce': { symbol: 'FA:1731', decimals: 8 },
  '0x829aa35bc1cfe0d4ef40cc7811f50b351b0322e82e294e4ddb93a24932233ae9': { symbol: 'FA:829A', decimals: 8 },
  '0xedae3361357d58812e7520f26d857e8e0e0c1efa461ca8c5a680e47c55cd8431': { symbol: 'FA:EDAE', decimals: 8 },
  '0xe7cca15eca75dcbf2330ae677b51d7ce58efc1c06102f5693d2cb3465f768fb6': { symbol: 'FA:E7CC', decimals: 8 },
  '0xfec06e91a1ba74038ec72ec926655a65684881d4a87bc691608454260412544e': { symbol: 'FA:FEC0', decimals: 8 },
  '0x70760d5b570a4d7261f948bcc0560d06b91e7e7af69e8d5f845f191855ec26bb': { symbol: 'FA:7076', decimals: 8 },
  '0x24deb5afeb93ff140fac344ceaee448fb6f5277a464f6c520dd7788e3ec39337': { symbol: 'FA:24DE', decimals: 8 },
  '0x53335614050129fe9a3706256e59e38054fefc2f8c1b02f223ac95ccd30e5846': { symbol: 'FA:5333', decimals: 8 },
  '0xf8ccddc70c8c14e6be77413ca8aac6b9c838da1d2aa1901d052f515cef4c206': { symbol: 'FA:F8CC', decimals: 8 },
  '0x6c0f967fee74918203a34c2b789676dfdb743c533466cdaa2f542b15e20be6fc': { symbol: 'FA:6C0F', decimals: 8 },
  '0x7b9c7c8c7563d1f7a62b487c1d0f5ee2148b151fc25a68cf1a23b4e7700cb5a5': { symbol: 'FA:7B9C', decimals: 8 },
  '0x42ecf580ff5c02dd10e82a547587ae63daef4c85f065739af3dc78249dc35a78': { symbol: 'FA:42EC', decimals: 8 },
  '0x929276d267804f5bba57f1fb03b16be0926bbaebd4bfbb6eaf4d63ee53dae325': { symbol: 'FA:9292', decimals: 8 },
  '0x7c860861da6225a8da88c201655201b497cfd3e39e57141fc4e30c3fc9e90454': { symbol: 'FA:7C86', decimals: 8 },
  '0x73f752a422144c748096115d650306341f1c2be24136b920eb995ca72c44cbd1': { symbol: 'FA:73F7', decimals: 8 },
  '0x928b49266aa4645250be8dc89060f50b1d7e5612e9f20477f025a6103720052': { symbol: 'FA:928B', decimals: 8 },
  '0x8fd1550a61055c1406e04d1a0ddf7049d00c889b59f6823f21ca7d842e1eaf3c': { symbol: 'FA:8FD1', decimals: 8 },
  '0xf04784a6bff37a4f2618cacac4ac71f351095903cdb640758db2113f38912bf': { symbol: 'FA:F047', decimals: 8 },
  '0x111409161c428e6a75e5f218f2e58163cab875b7661ab33e3635fca663c0870b': { symbol: 'FA:1114', decimals: 8 },
  '0x4c8bef4753c4fd562a8d957f148625dc60101ea6584c6bc67051f303dfd8ca7e': { symbol: 'FA:4C8B', decimals: 8 },
  '0x335e4152207b86fba8cf1eadddc8d9f0804f88b7d66d68bda066be0aecf8b6d8': { symbol: 'FA:335E', decimals: 8 },
  '0xae2684197f513b6f07fee7ad08cf49ffeaaa037f05795be3589d60d3d32a2587': { symbol: 'FA:AE26', decimals: 8 },
  '0x36a51ff5e4a536a5c885b758249092dea44e22a3bf2cf111273b6d372c48e408': { symbol: 'FA:36A5', decimals: 8 },
  '0x3bcc1d5d501969b70b57eccb09dbe98a1289590e6ca237a8dbdb715d13e0f225': { symbol: 'FA:3BCC', decimals: 8 },
  '0xa101dd55fd41075dc42084dd00b956233dbf5b30c97bca0cb8ea0cd2e9543a82': { symbol: 'FA:A101', decimals: 8 },
  '0xbc8d1fb1ea5f22dd931935cbdcb128bbb205e567a6b5225fe6994f8bafc8702a': { symbol: 'FA:BC8D', decimals: 8 },
  '0xf9899d734f2b565eedc604672d4d2ff6e4994ba9ad6454d41399089e189fd0d1': { symbol: 'FA:F989', decimals: 8 },
  '0x64d89d4c98cd3ea87f388f563bcac383edfaf85607a1ddd84a810011e6e2e9e6': { symbol: 'FA:64D8', decimals: 8 },
};

const SYMBOL_TO_ADDR = {};
for (const [addr, info] of Object.entries(FA_MAP)) {
  SYMBOL_TO_ADDR[info.symbol] = addr;
}

const _runtime = {};

function getSymbol(addr) {
  if (!addr) return '???';
  return FA_MAP[addr]?.symbol || _runtime[addr]?.symbol || _shortAddr(addr);
}

function getDecimals(addr) {
  return 8; // Todos os tokens na Atmos usam 8 decimals
}

function registerFA(addr, symbol, decimals = 8) {
  if (FA_MAP[addr]) return;
  _runtime[addr] = { symbol: symbol || _shortAddr(addr), decimals };
}

function isKnown(addr) {
  return !!(FA_MAP[addr] || _runtime[addr]);
}

function _shortAddr(addr) {
  if (!addr) return '???';
  const s = addr.startsWith('0x') ? addr.slice(2) : addr;
  return s.slice(0, 4) + '..' + s.slice(-4);
}

// === FUNÇÃO NOVA: Busca símbolo on-chain ===
async function getFASymbolDynamic(client, metadataAddr) {
  if (FA_MAP[metadataAddr]) return FA_MAP[metadataAddr];

  try {
    const res = await client.getAccountResource(metadataAddr, "0x1::fungible_asset::Metadata");
    const symbol = res?.data?.symbol?.value || res?.data?.symbol || '';
    const name = res?.data?.name?.value || '';
    const finalSymbol = symbol || name.substring(0, 12) || _shortAddr(metadataAddr);

    registerFA(metadataAddr, finalSymbol);
    return { symbol: finalSymbol, decimals: 8 };
  } catch (e) {
    const short = _shortAddr(metadataAddr);
    registerFA(metadataAddr, short);
    return { symbol: short, decimals: 8 };
  }
}

module.exports = { 
  FA_MAP, 
  SYMBOL_TO_ADDR, 
  getSymbol, 
  getDecimals, 
  registerFA, 
  isKnown,
  getFASymbolDynamic 
};