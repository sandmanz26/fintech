/** Landing page copy, Indonesian first (the audience), English on ?lang=en. */

export type Lang = "id" | "en";

export const COPY = {
  id: {
    nav: { how: "Cara kerja", demo: "Coba demo", open: "Buka workspace", lang: "English", langHref: "/?lang=en" },
    hero: {
      eyebrow: "Ruang kerja tim risiko untuk payment aggregator",
      title: "Pilih toko yang boleh menerima kartu. Awasi setiap hari. Bertindak sebelum rugi.",
      sub: "Sentinel membantu tim risiko perusahaan pembayaran menilai toko yang mendaftar, mendeteksi tanda bahaya dari transaksi harian, menahan dana bila perlu, dan membuktikan siapa memutuskan apa. Setiap keputusan bisa dijelaskan, tanpa kotak hitam AI.",
      cta: "Coba demo, tanpa daftar",
      cta2: "Lihat cara kerjanya",
      note: "Data fiktif: 200 toko, ±180 ribu transaksi kartu, 6 peran.",
    },
    problem: {
      kicker: "Masalahnya",
      title: "Saat toko bermasalah, yang menanggung lebih dulu adalah perusahaan pembayarannya.",
      body: "Toko kecil sulit mendapat akun kartu (MID) langsung dari bank. Perusahaan pembayaran seperti aggregator punya satu akun induk di bank dan menampung ribuan toko di bawahnya. Praktis untuk toko, tapi di mata bank semua transaksi itu atas nama perusahaan pembayaran.",
      flow: [
        { t: "Pembeli", d: "Bayar pakai kartu" },
        { t: "Toko", d: "Sub-merchant" },
        { t: "Kestrel Pay", d: "Aggregator, pemilik MID induk", hl: true },
        { t: "Bank acquirer", d: "Memproses kartu" },
        { t: "Visa · Mastercard", d: "Jaringan kartu" },
      ],
      back: "Kalau pembeli membatalkan transaksi (chargeback), toko menipu, atau toko kabur setelah menerima pesanan, tagihannya kembali ke Kestrel Pay.",
      risks: [
        { t: "Chargeback", d: "Pembeli minta uangnya kembali lewat bank. Bank menarik dananya dari perusahaan pembayaran." },
        { t: "Denda jaringan kartu", d: "Kalau rasio sengketa melewati batas Visa atau Mastercard (sekitar 1,5%), perusahaan pembayaran diawasi dan didenda." },
        { t: "Toko kabur", d: "Pesanan dibayar di muka, barang tak pernah dikirim. Uang yang sudah dicairkan sulit ditarik kembali." },
      ],
    },
    steps: {
      kicker: "Apa yang dilakukan Sentinel",
      title: "Satu alur, dari toko mendaftar sampai toko ditutup.",
      items: [
        { t: "Daftar", d: "Toko mengisi profil: jenis usaha, volume, lama pengiriman, pemilik." },
        { t: "Nilai risiko", d: "Cek registrasi, website, daftar sanksi; skor 0–100 yang setiap poinnya dijelaskan." },
        { t: "Pantau", d: "Transaksi harian dihitung per toko; aturan mencari lonjakan, card testing, chargeback tinggi." },
        { t: "Selidiki", d: "Tanda bahaya membuka kasus. Analis memeriksa bukti dan meminta dokumen ke toko lewat link aman." },
        { t: "Bertindak", d: "Tahan sebagian penjualan (reserve), batasi volume, atau tahan pencairan. Dampaknya terlihat sebelum disimpan." },
        { t: "Setujui berdua", d: "Keputusan besar butuh orang kedua. Yang mengajukan tidak boleh menyetujui sendiri." },
        { t: "Tutup", d: "Pemrosesan dihentikan, dana ditahan sampai chargeback susulan tak mungkin datang, toko dicatat di daftar hitam." },
      ],
    },
    shots: [
      { src: "/landing/dashboard.webp", t: "Hari ini", d: "Apa yang perlu dikerjakan, mana yang lewat batas waktu, dan panduan demo langkah demi langkah." },
      { src: "/landing/merchant.webp", t: "Profil toko", d: "Skor risiko dijelaskan per faktor, rasio Visa dan Mastercard dengan batasnya, dan berapa uang yang terancam." },
      { src: "/landing/portfolio.webp", t: "Portofolio", d: "Seberapa dekat perusahaan dengan batas jaringan kartu, dan toko mana penyumbang terbesarnya." },
    ],
    why: {
      kicker: "Kenapa bisa dipercaya",
      items: [
        { t: "Bisa dijelaskan", d: "Tanpa AI. Skor adalah penjumlahan faktor yang tertulis; aturan adalah kondisi yang bisa dibaca dan diuji ke data 90 hari." },
        { t: "Empat mata", d: "Penahanan dana, reserve besar, dan penutupan toko selalu butuh persetujuan orang kedua yang berwenang." },
        { t: "Jejak audit anti-ubah", d: "Setiap keputusan tercatat dengan siapa, kapan, dan alasannya, dirantai dengan hash. Perubahan diam-diam langsung ketahuan." },
        { t: "Sesuai aturan jaringan", d: "Rasio dihitung seperti Visa (VAMP) dan Mastercard (ECM) menghitungnya, termasuk total portofolio yang dinilai bank." },
      ],
    },
    people: {
      kicker: "Siapa yang memakai",
      items: [
        { n: "Rina", r: "Analis risiko", d: "Mengerjakan antrean alert dan kasus." },
        { n: "Dimas", r: "Underwriter senior", d: "Menilai toko berisiko tinggi." },
        { n: "Laura", r: "Kepala risiko", d: "Menyetujui keputusan besar, memegang aturan." },
        { n: "Ahmad", r: "Compliance", d: "Menangani kecocokan daftar sanksi." },
        { n: "Grace", r: "Auditor", d: "Membaca semuanya, memeriksa jejak audit." },
        { n: "Sam", r: "Admin", d: "Mengatur pengguna dan konfigurasi." },
      ],
    },
    stories: {
      kicker: "Coba sendiri",
      title: "Lima situasi nyata, masing-masing 2–5 menit.",
      sub: "Setiap tombol di halaman masuk langsung membuka layar yang tepat sebagai orang yang tepat. Anda memerankan beberapa orang; panduan demo menunjukkan langkah berikutnya.",
      items: [
        { k: "S1", t: "Menilai agen perjalanan berisiko tinggi", d: "Lengkapi checklist, setujui dengan reserve 10%." },
        { k: "S2", t: "Volume melonjak 5×", d: "Minta dokumen ke toko lewat portal, pasang batas harian." },
        { k: "S3", t: "Card testing", d: "620 transaksi kecil dalam sehari; tahan pencairan, kepala risiko menyetujui." },
        { k: "S4", t: "Mendekati batas Visa", d: "Lihat watchlist portofolio, pasang reserve tetap." },
        { k: "S5", t: "Pemilik masuk daftar sanksi", d: "Usulkan penutupan, compliance menyetujui, dana ditahan 120 hari." },
      ],
      cta: "Mulai demo",
    },
    faq: {
      kicker: "Pertanyaan umum",
      items: [
        { q: "Apakah datanya asli?", a: "Tidak. Semua toko, orang, dan transaksi fiktif, dibuat dengan simulasi yang sama setiap kali. Kestrel Pay juga perusahaan fiktif." },
        { q: "Apakah ini produk Midtrans atau Xendit?", a: "Bukan. Sentinel adalah contoh alat kerja untuk tim risiko perusahaan pembayaran mana pun yang memakai model aggregator." },
        { q: "Apakah memakai AI?", a: "Tidak. Semua penilaian memakai aturan tertulis yang bisa dibaca, diuji, dan diubah dengan catatan alasan." },
        { q: "Kenapa perubahan saya hilang?", a: "Demo menyimpan perubahan di memori server. Saat server dimulai ulang, data kembali ke titik awal, dan aplikasi memberi tahu Anda." },
      ],
    },
    footer: "Sentinel · demo produk dengan data fiktif",
    guide: "Panduan lengkap (English)",
  },
  en: {
    nav: { how: "How it works", demo: "Try the demo", open: "Open workspace", lang: "Bahasa Indonesia", langHref: "/" },
    hero: {
      eyebrow: "The risk team's workspace for payment aggregators",
      title: "Choose which shops may take cards. Watch them every day. Act before the loss.",
      sub: "Sentinel helps a payment company's risk team assess shops that apply, spot warning signs in daily transactions, hold funds when needed, and prove who decided what. Every decision is explained, with no AI black box.",
      cta: "Try the demo, no sign-up",
      cta2: "See how it works",
      note: "Fictional data: 200 shops, ~180,000 card payments, 6 roles.",
    },
    problem: {
      kicker: "The problem",
      title: "When a shop goes wrong, the payment company pays first.",
      body: "Small shops struggle to get a card merchant account (MID) from a bank. A payment aggregator holds one master account with the bank and serves thousands of shops under it. Easy for the shops, but to the bank every payment belongs to the payment company.",
      flow: [
        { t: "Buyer", d: "Pays by card" },
        { t: "Shop", d: "Sub-merchant" },
        { t: "Kestrel Pay", d: "Aggregator, holds the master MID", hl: true },
        { t: "Acquiring bank", d: "Processes cards" },
        { t: "Visa · Mastercard", d: "Card networks" },
      ],
      back: "When a buyer disputes a payment (chargeback), a shop commits fraud, or a shop vanishes after taking orders, the bill comes back to Kestrel Pay.",
      risks: [
        { t: "Chargebacks", d: "The buyer gets the money back through the bank, which takes it from the payment company." },
        { t: "Network fines", d: "Above Visa's or Mastercard's dispute lines (around 1.5%), the payment company is monitored and fined." },
        { t: "Shops that vanish", d: "Orders paid upfront, goods never shipped. Money already paid out is hard to recover." },
      ],
    },
    steps: {
      kicker: "What Sentinel does",
      title: "One flow, from a shop applying to a shop closing.",
      items: [
        { t: "Apply", d: "The shop declares its business, volume, delivery time and owners." },
        { t: "Assess", d: "Registry, website and sanctions checks; a 0–100 score with every point explained." },
        { t: "Monitor", d: "Daily totals per shop; rules look for spikes, card testing, high chargebacks." },
        { t: "Investigate", d: "A warning opens a case. The analyst reviews evidence and requests documents through a secure link." },
        { t: "Act", d: "Hold part of sales (a reserve), cap volume, or hold payouts. The effect is shown before saving." },
        { t: "Approve in pairs", d: "Big decisions need a second person. Whoever asks can never approve." },
        { t: "Close", d: "Processing stops, funds are held until late chargebacks can no longer arrive, the shop is listed." },
      ],
    },
    shots: [
      { src: "/landing/dashboard.webp", t: "Today", d: "What needs doing, what is past its deadline, and the step-by-step demo guide." },
      { src: "/landing/merchant.webp", t: "Shop profile", d: "The risk score explained factor by factor, Visa and Mastercard ratios against their lines, and the money at risk." },
      { src: "/landing/portfolio.webp", t: "Portfolio", d: "How close the company is to the card networks' lines, and which shops contribute most." },
    ],
    why: {
      kicker: "Why it can be trusted",
      items: [
        { t: "Explainable", d: "No AI. The score is a sum of written factors; rules are readable conditions you can test on 90 days of data." },
        { t: "Four-eyes", d: "Payout holds, large reserves and terminations always need a second, authorised person." },
        { t: "Tamper-evident audit", d: "Every decision with who, when and why, chained by hash. A quiet edit is detected." },
        { t: "Network-accurate", d: "Ratios computed the way Visa (VAMP) and Mastercard (ECM) compute them, including the portfolio total the bank assesses." },
      ],
    },
    people: {
      kicker: "Who uses it",
      items: [
        { n: "Rina", r: "Risk analyst", d: "Works the alert and case queues." },
        { n: "Dimas", r: "Senior underwriter", d: "Assesses high-risk shops." },
        { n: "Laura", r: "Head of risk", d: "Approves big decisions, owns the rules." },
        { n: "Ahmad", r: "Compliance", d: "Handles sanctions matches." },
        { n: "Grace", r: "Auditor", d: "Reads everything, checks the audit trail." },
        { n: "Sam", r: "Admin", d: "Users and configuration." },
      ],
    },
    stories: {
      kicker: "Try it yourself",
      title: "Five real situations, 2–5 minutes each.",
      sub: "Each button on the sign-in page opens the right screen as the right person. You play several people; the demo guide shows the next step.",
      items: [
        { k: "S1", t: "Assess a high-risk travel agency", d: "Finish the checklist, approve with a 10% reserve." },
        { k: "S2", t: "Volume up 5×", d: "Request documents through the portal, set a daily limit." },
        { k: "S3", t: "Card testing", d: "620 tiny payments in a day; hold payouts, the head of risk approves." },
        { k: "S4", t: "Near the Visa line", d: "Check the portfolio watchlist, set a fixed reserve." },
        { k: "S5", t: "Owner on a sanctions list", d: "Propose termination, compliance approves, funds held 120 days." },
      ],
      cta: "Start the demo",
    },
    faq: {
      kicker: "Questions",
      items: [
        { q: "Is the data real?", a: "No. Every shop, person and payment is fictional, generated the same way each time. Kestrel Pay is fictional too." },
        { q: "Is this a Midtrans or Xendit product?", a: "No. Sentinel is an example tool for the risk team of any payment company using the aggregator model." },
        { q: "Does it use AI?", a: "No. Every assessment uses written rules that can be read, tested and changed with a reason." },
        { q: "Why did my changes disappear?", a: "The demo keeps changes in the server's memory. When the server restarts, the data goes back to the start, and the app tells you." },
      ],
    },
    footer: "Sentinel · a product demo with fictional data",
    guide: "Full guide",
  },
} as const;
