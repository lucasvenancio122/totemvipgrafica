// Conversor do totem: deixa qualquer arquivo aceito em PDF, JPG ou PNG antes de enviar.
// - PDF, JPG, PNG: passam direto
// - HEIC/HEIF (foto do iPhone): vira JPG
// - WEBP, GIF, BMP, AVIF e outras imagens que o navegador abre: viram JPG
// - TXT: vira PDF A4
// - Word, Excel, PowerPoint: ainda não (precisa do app final no totem)
(function () {
  const LIBS = {
    heic: "https://cdn.jsdelivr.net/npm/heic2any@0.0.4/dist/heic2any.min.js",
    pdf: "https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js"
  };
  const carregando = {};
  function carregar(url) {
    if (!carregando[url]) carregando[url] = new Promise((ok, falha) => {
      const s = document.createElement("script");
      s.src = url; s.onload = ok; s.onerror = () => { delete carregando[url]; falha(new Error("lib")); };
      document.head.appendChild(s);
    });
    return carregando[url];
  }
  const erro = msg => Object.assign(new Error(msg), { totem: true });
  const trocaExt = (nome, ext) => nome.replace(/\.[^.\/]+$/, "") + "." + ext;

  const OFFICE = /\.(docx?|dotx?|odt|rtf|xlsx?|xlsm|ods|csv|pptx?|ppsx?|odp|pages|numbers|key)$/i;
  const ARTE = /\.(cdr|psd|ai|eps|indd|svg)$/i;
  const IMG_NAV = /\.(webp|gif|bmp|avif|jfif|tiff?)$/i;

  async function imagemParaJpg(blob, nome) {
    let fonte;
    try { fonte = await createImageBitmap(blob); }
    catch {
      fonte = await new Promise((ok, falha) => {
        const im = new Image(); const u = URL.createObjectURL(blob);
        im.onload = () => { URL.revokeObjectURL(u); ok(im); };
        im.onerror = () => { URL.revokeObjectURL(u); falha(); };
        im.src = u;
      }).catch(() => { throw erro(`Não foi possível abrir a imagem "${nome}".`); });
    }
    const max = 4000, w0 = fonte.width, h0 = fonte.height, k = Math.min(1, max / Math.max(w0, h0));
    const c = document.createElement("canvas");
    c.width = Math.round(w0 * k); c.height = Math.round(h0 * k);
    const g = c.getContext("2d");
    g.fillStyle = "#fff"; g.fillRect(0, 0, c.width, c.height); // transparência vira branco
    g.drawImage(fonte, 0, 0, c.width, c.height);
    const out = await new Promise(ok => c.toBlob(ok, "image/jpeg", 0.92));
    return { blob: out, nome: trocaExt(nome, "jpg"), tipo: "img", mime: "image/jpeg" };
  }

  async function textoParaPdf(blob, nome) {
    const buf = await blob.arrayBuffer();
    let txt = new TextDecoder("utf-8").decode(buf);
    if (txt.includes("\uFFFD")) txt = new TextDecoder("windows-1252").decode(buf); // txt antigo do Windows
    txt = txt.replace(/^\uFEFF/, "").replace(/\r\n?/g, "\n").replace(/\t/g, "    ");
    if (!txt.trim()) throw erro(`"${nome}" está vazio.`);
    await carregar(LIBS.pdf).catch(() => { throw erro("Sem internet para converter o TXT. Tente de novo."); });
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF({ unit: "mm", format: "a4" });
    const m = 20, larg = 210 - 2 * m, alt = 297 - 2 * m, lh = 5.2;
    doc.setFont("helvetica", "normal"); doc.setFontSize(11);
    let y = m;
    for (const par of txt.split("\n")) {
      const linhas = par === "" ? [""] : doc.splitTextToSize(par, larg);
      for (const l of linhas) {
        if (y + lh > m + alt) { doc.addPage(); y = m; }
        doc.text(l, m, y + 4); y += lh;
      }
    }
    return { blob: doc.output("blob"), nome: trocaExt(nome, "pdf"), tipo: "pdf", mime: "application/pdf" };
  }

  async function normalizar(file) {
    const nome = file.name || "arquivo";
    const low = nome.toLowerCase(), t = (file.type || "").toLowerCase();
    if (file.size > 60 * 1024 * 1024) throw erro("Arquivo muito grande (mais de 60 MB). Peça no balcão.");
    if (OFFICE.test(low)) throw erro("Arquivos do Word, Excel e PowerPoint ainda não são aceitos aqui. Salve como PDF no celular e envie de novo.");
    if (ARTE.test(low)) throw erro("Arquivos de arte (Corel, Photoshop, Illustrator) são feitos no balcão.");

    let r;
    if (low.endsWith(".pdf") || t === "application/pdf") r = { blob: file, nome, tipo: "pdf", mime: "application/pdf" };
    else if (/\.(jpe?g)$/.test(low) || t === "image/jpeg") r = { blob: file, nome, tipo: "img", mime: "image/jpeg" };
    else if (low.endsWith(".png") || t === "image/png") r = { blob: file, nome, tipo: "img", mime: "image/png" };
    else if (/\.(heic|heif)$/.test(low) || /image\/hei[cf]/.test(t)) {
      await carregar(LIBS.heic).catch(() => { throw erro("Sem internet para converter a foto. Tente de novo."); });
      let out;
      try { out = await window.heic2any({ blob: file, toType: "image/jpeg", quality: 0.92 }); }
      catch { throw erro(`Não foi possível converter a foto "${nome}".`); }
      r = { blob: Array.isArray(out) ? out[0] : out, nome: trocaExt(nome, "jpg"), tipo: "img", mime: "image/jpeg" };
    }
    else if (IMG_NAV.test(low) || t.startsWith("image/")) r = await imagemParaJpg(file, nome);
    else if (low.endsWith(".txt") || t === "text/plain") r = await textoParaPdf(file, nome);
    else throw erro(`"${nome}" não é um tipo aceito. Envie PDF, foto ou TXT.`);

    if (r.blob.size > 20 * 1024 * 1024) throw erro("Depois de preparado, o arquivo passou de 20 MB. Peça no balcão.");
    r.convertido = r.blob !== file;
    return r;
  }

  window.TotemConversor = {
    normalizar,
    ACCEPT: ".pdf,.jpg,.jpeg,.png,.heic,.heif,.webp,.gif,.bmp,.avif,.txt,application/pdf,image/*,text/plain",
    TIPOS: "PDF, fotos (JPG, PNG, HEIC, WEBP) ou TXT"
  };
})();
