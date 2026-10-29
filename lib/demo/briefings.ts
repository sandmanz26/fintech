import type { Role } from "@prisma/client";
import type { StoryState } from "./stories";

/**
 * Plain-language explanations for first-time users: each guided story as a briefing, every
 * alert rule and every case type. Indonesian by default, English when chosen (cookie "lang").
 */

export type Lang = "id" | "en";
type Text = Record<Lang, string>;

export type StoryStep = { who: Role; text: Text; phase: Exclude<StoryState, "done"> };
export type StoryBrief = {
  title: Text;
  situation: Text;
  why: Text;
  steps: StoryStep[];
  done: Text;
  concept: { term: Text; text: Text };
};

export const PERSON: Record<Role, string> = {
  ANALYST: "Rina",
  SENIOR_ANALYST: "Dimas",
  RISK_MANAGER: "Laura",
  COMPLIANCE: "Ahmad",
  AUDITOR: "Grace",
  ADMIN: "Sam",
  MERCHANT: "Merchant",
};

export const STORY_BRIEFS: Record<"S1" | "S2" | "S3" | "S4" | "S5", StoryBrief> = {
  S1: {
    title: { id: "Menilai agen perjalanan berisiko tinggi", en: "Assessing a high-risk travel agency" },
    situation: {
      id: "Lumen Travel Co. mendaftar untuk menerima kartu. Mereka menjual paket wisata yang baru berangkat rata-rata 45 hari setelah dibayar, dengan target Rp-setara $375.000 per bulan, dan baru berdiri 4 bulan.",
      en: "Lumen Travel Co. applied to accept cards. It sells trips that depart on average 45 days after payment, expects $375,000 a month, and is four months old.",
    },
    why: {
      id: "Kalau agen perjalanan bangkrut sebelum tamunya berangkat, semua tamu minta uang kembali lewat bank (chargeback), dan Kestrel Pay yang membayar. Makin lama jarak bayar-ke-berangkat dan makin besar volumenya, makin besar uang yang terancam.",
      en: "If a travel agency fails before its customers travel, they all claim their money back through their banks (chargebacks), and Kestrel Pay pays. The longer the gap between payment and travel and the bigger the volume, the more money is at risk.",
    },
    steps: [
      { who: "SENIOR_ANALYST", phase: "todo", text: { id: "Buka checklist dan periksa yang belum lolos: terima laporan bank dan laporan pemrosesan sebelumnya, lalu centang 'Exposure calculated'.", en: "Open the checklist and clear what is pending: accept the bank and processing statements, then tick 'Exposure calculated'." } },
      { who: "SENIOR_ANALYST", phase: "todo", text: { id: "Pilih 'Approve with conditions', tambahkan rolling reserve 10% selama 120 hari, dan lihat grafik dampaknya ke arus kas toko sebelum mengirim.", en: "Choose 'Approve with conditions', add a 10% rolling reserve for 120 days, and check its effect on the shop's cash before sending." } },
      { who: "RISK_MANAGER", phase: "waiting", text: { id: "Reserve 10% melewati batas empat mata, jadi Laura harus menyetujuinya di menu Approvals.", en: "A 10% reserve is over the four-eyes line, so Laura approves it in Approvals." } },
    ],
    done: { id: "Toko disetujui dengan syarat. Reserve aktif: 10% dari setiap penjualan ditahan 120 hari sebagai bantalan.", en: "Approved with conditions. The reserve is live: 10% of each day's sales is held for 120 days as a cushion." },
    concept: { term: { id: "Rolling reserve", en: "Rolling reserve" }, text: { id: "Sebagian penjualan harian ditahan lalu dilepas setelah sekian hari. Kalau toko bermasalah, uang inilah yang membayar chargeback.", en: "A share of each day's sales is held and released after a set number of days. If the shop fails, this money pays the chargebacks." } },
  },
  S2: {
    title: { id: "Volume melonjak 5 kali lipat", en: "Volume up five-fold" },
    situation: {
      id: "Brightside Electronics biasanya menjual ±$13.000 sehari. Tiga hari terakhir penjualannya melonjak sekitar 5 kali lipat, dengan nilai belanja rata-rata 3 kali lebih besar dari biasanya.",
      en: "Brightside Electronics usually sells about $13,000 a day. For the last three days volume is up about five-fold, with the average order three times bigger than usual.",
    },
    why: {
      id: "Lonjakan bisa wajar (promo, musim liburan), tapi juga pola klasik 'bust-out': toko menjual sebanyak mungkin, menerima pencairan dana, lalu menghilang sebelum barang dikirim.",
      en: "A spike can be innocent (a promotion, a holiday), or the classic bust-out: sell as much as possible, collect the payout, vanish before shipping.",
    },
    steps: [
      { who: "ANALYST", phase: "todo", text: { id: "Buka kasus, klik 'Start review', lalu 'Request documents' untuk meminta invoice pesanan besar. Sistem membuat link portal yang aman untuk toko.", en: "Open the case, click 'Start review', then 'Request documents' to ask for invoices of the large orders. Sentinel creates a secure portal link for the shop." } },
      { who: "ANALYST", phase: "todo", text: { id: "Buka link portal itu (Anda berperan sebagai pemilik toko) dan unggah PDF. Toko hanya melihat daftar dokumen dan tenggat, tidak ada data internal.", en: "Open that portal link (you play the shop owner) and upload a PDF. The shop sees only the list and the due date, nothing internal." } },
      { who: "ANALYST", phase: "todo", text: { id: "Kembali ke kasus, pasang batas volume harian sementara, lalu tutup kasus dengan alasan.", en: "Back on the case, set a temporary daily volume limit, then close the case with a reason." } },
    ],
    done: { id: "Dokumen diterima, batas harian terpasang, kasus ditutup dengan catatan.", en: "Documents received, a daily limit set, the case closed with a note." },
    concept: { term: { id: "RFI (Request for Information)", en: "RFI (request for information)" }, text: { id: "Permintaan dokumen ke toko lewat link pribadi yang kedaluwarsa. Selama menunggu, jam SLA kasus berhenti.", en: "A document request to the shop through a private, expiring link. While waiting, the case's SLA clock pauses." } },
  },
  S3: {
    title: { id: "Card testing: tahan pencairan dana", en: "Card testing: hold payouts" },
    situation: {
      id: "Dalam satu hari QuickTop Gift Cards menerima 620 transaksi di bawah $2, dan 72% di antaranya ditolak bank.",
      en: "In one day QuickTop Gift Cards received 620 payments under $2, and 72% were declined.",
    },
    why: {
      id: "Ini tanda 'card testing': penjahat mencoba ratusan nomor kartu curian dengan nominal kecil untuk mencari yang masih aktif. Kartu yang lolos nanti dipakai untuk belanja besar, lalu pemilik aslinya mengajukan chargeback.",
      en: "This is card testing: criminals try hundreds of stolen card numbers with tiny amounts to find live ones. The cards that work are used for big purchases later, and the real owners file chargebacks.",
    },
    steps: [
      { who: "ANALYST", phase: "todo", text: { id: "Buka kasus kritis, baca bukti (jumlah transaksi kecil, tingkat penolakan), klik 'Start review'.", en: "Open the critical case, read the evidence (tiny payments, decline rate), click 'Start review'." } },
      { who: "ANALYST", phase: "todo", text: { id: "Klik 'Open control editor', pilih 'Payout hold' (tahan pencairan), isi alasan, kirim. Rina tidak boleh memutuskan sendiri: permintaan menunggu persetujuan.", en: "Click 'Open control editor', choose 'Payout hold', give a reason, send. Rina may not decide alone: the request waits for approval." } },
      { who: "RISK_MANAGER", phase: "waiting", text: { id: "Laura membaca bukti dan dampaknya, menulis catatan, lalu 'Approve and carry out'. Penahanan langsung berlaku.", en: "Laura reads the evidence and the effect, writes a note, then 'Approve and carry out'. The hold applies at once." } },
    ],
    done: { id: "Pencairan dana ke toko ditahan; toko berstatus Restricted sampai checkout-nya diamankan.", en: "Payouts to the shop are held; the shop is Restricted until its checkout is secured." },
    concept: { term: { id: "Empat mata (four-eyes)", en: "Four-eyes" }, text: { id: "Keputusan berdampak besar butuh dua orang: satu mengusulkan, satu lagi yang berwenang menyetujui. Yang mengusulkan tidak bisa menyetujui sendiri, dan server menolaknya.", en: "High-impact decisions need two people: one proposes, an authorised second person approves. The proposer can never approve, and the server refuses it." } },
  },
  S4: {
    title: { id: "Mendekati batas Visa", en: "Near the Visa line" },
    situation: {
      id: "Glow Subscription Box menjual langganan bulanan. Dalam 60 hari, sengketa dan laporan penipuannya naik dari 0,35% ke sekitar 1,3% dari penjualan kartu Visa, mendekati batas program Visa 1,5%.",
      en: "Glow Subscription Box sells monthly subscriptions. In 60 days its disputes and fraud reports rose from 0.35% to about 1.3% of Visa card sales, close to Visa's 1.5% program line.",
    },
    why: {
      id: "Kalau melewati batas, Visa memasukkan toko (dan menilai Kestrel Pay) ke program pengawasan dengan denda. Langganan yang sulit dibatalkan sering memicu sengketa 'tidak mengenali tagihan'.",
      en: "Over the line, Visa puts the shop (and assesses Kestrel Pay) into a monitoring program with fines. Subscriptions that are hard to cancel often cause 'I don't recognise this charge' disputes.",
    },
    steps: [
      { who: "RISK_MANAGER", phase: "todo", text: { id: "Lihat Portfolio → Network watchlist: Glow ada di sana, dengan rasio Visa (VAMP) dan Mastercard (ECM) masing-masing terhadap batasnya.", en: "See Portfolio → Network watchlist: Glow is there, with its Visa (VAMP) and Mastercard (ECM) ratios each against its line." } },
      { who: "SENIOR_ANALYST", phase: "todo", text: { id: "Dimas membuka kasus sengketa dan mengusulkan fixed reserve $60.000 (25% penjualan harian ditahan sampai target tercapai).", en: "Dimas opens the dispute case and proposes a $60,000 fixed reserve (25% of daily sales held until the target is reached)." } },
      { who: "RISK_MANAGER", phase: "waiting", text: { id: "Jumlahnya di atas batas empat mata $50.000, jadi Laura menyetujuinya.", en: "It is over the $50,000 four-eyes line, so Laura approves it." } },
    ],
    done: { id: "Reserve tetap terpasang; toko Restricted sementara rasio sengketanya diawasi.", en: "The fixed reserve is in place; the shop is Restricted while its dispute ratio is watched." },
    concept: { term: { id: "Visa VAMP dan Mastercard ECM", en: "Visa VAMP and Mastercard ECM" }, text: { id: "Program pengawasan jaringan kartu. Visa menghitung laporan penipuan + sengketa dibagi penjualan online; Mastercard membandingkan chargeback bulan ini dengan penjualan bulan lalu. Batasnya sekitar 1,5%.", en: "The card networks' monitoring programs. Visa counts fraud reports plus disputes over online sales; Mastercard compares this month's chargebacks with last month's sales. The lines are around 1.5%." } },
  },
  S5: {
    title: { id: "Pemilik masuk daftar sanksi", en: "An owner on a sanctions list" },
    situation: {
      id: "Pemeriksaan ulang rutin menemukan bahwa Marek Dobrev, pengendali Nimbus Supplements, cocok dengan daftar sanksi. Compliance (Ahmad) sudah mengonfirmasi kecocokannya. Rasio chargeback toko ini juga di atas 0,9%.",
      en: "Routine rescreening found that Marek Dobrev, a controller of Nimbus Supplements, matches a sanctions list. Compliance (Ahmad) has confirmed it. The shop's chargebacks are also above 0.9%.",
    },
    why: {
      id: "Memproses pembayaran untuk orang yang terkena sanksi melanggar hukum. Hubungan harus diakhiri, tapi uang toko tidak boleh langsung dilepas: chargeback atas penjualan lama masih bisa datang sampai 120 hari.",
      en: "Processing payments for a sanctioned person is illegal. The relationship must end, but the shop's money cannot be released at once: chargebacks on past sales can arrive for up to 120 days.",
    },
    steps: [
      { who: "ANALYST", phase: "todo", text: { id: "Buka kasus watchlist, klik 'Propose termination…', pilih alasan 'Compliance or sanctions', tulis bukti, ketik nama toko untuk konfirmasi.", en: "Open the watchlist case, click 'Propose termination…', choose 'Compliance or sanctions', write the evidence, type the shop's name to confirm." } },
      { who: "COMPLIANCE", phase: "waiting", text: { id: "Ahmad (compliance) menyetujui. Pemrosesan berhenti, toko dan pemiliknya dicatat di daftar terminated merchant.", en: "Ahmad (compliance) approves. Processing stops; the shop and its owners go on the terminated-merchant list." } },
    ],
    done: { id: "Toko dalam proses penutupan: reserve ditahan selama masa sengketa, lalu sisanya dihitung dan dicairkan.", en: "The shop is being offboarded: the reserve is held through the dispute window, then the remainder is reconciled and paid out." },
    concept: { term: { id: "Daftar terminated merchant (seperti MATCH)", en: "Terminated-merchant list (like MATCH)" }, text: { id: "Daftar toko dan pemilik yang ditutup karena alasan serius. Penyedia pembayaran memeriksanya sebelum menerima toko baru, supaya pemilik yang sama tidak bisa mendaftar lagi dengan nama lain.", en: "A list of shops and owners closed for serious reasons. Payment providers check it before boarding, so the same owner cannot come back under another name." } },
  },
};

/** What each alert rule means, why it matters, and what people usually do. */
export const RULE_EXPLAIN: Record<string, { what: Text; why: Text; act: Text }> = {
  "R-VOL-SPIKE": {
    what: { id: "Penjualan hari ini lebih dari 3 kali rata-rata harian 30 hari terakhir.", en: "Today's sales are more than three times the 30-day daily average." },
    why: { id: "Bisa promo biasa, bisa juga toko yang mau kabur setelah mengumpulkan uang (bust-out).", en: "It may be a promotion, or a shop collecting as much as it can before vanishing (bust-out)." },
    act: { id: "Minta invoice pesanan besar; pasang batas harian sementara bila belum jelas.", en: "Ask for invoices of the large orders; set a temporary daily limit until it is clear." },
  },
  "R-VOL-OVER-PROFILE": {
    what: { id: "Penjualan 30 hari melebihi 150% dari volume bulanan yang dijanjikan toko saat mendaftar.", en: "30-day sales are over 150% of the monthly volume the shop declared." },
    why: { id: "Risiko dinilai berdasarkan profil yang dideklarasikan; kalau toko tumbuh jauh di atasnya, perlindungan yang ada tidak lagi sepadan.", en: "Risk was assessed on the declared profile; if the shop outgrows it, the protection in place no longer fits." },
    act: { id: "Kalau pertumbuhannya sah (ada bukti), perbarui profil yang dideklarasikan; kalau tidak, selidiki.", en: "If the growth is genuine (with evidence), update the declared profile; otherwise investigate." },
  },
  "R-CB-RATIO": {
    what: { id: "Chargeback 30 hari di atas 0,75% dari transaksi, dengan minimal 10 chargeback.", en: "30-day chargebacks above 0.75% of transactions, with at least 10." },
    why: { id: "Setiap chargeback adalah uang yang ditarik kembali dari Kestrel Pay, ditambah biaya.", en: "Every chargeback is money taken back from Kestrel Pay, plus a fee." },
    act: { id: "Cari penyebabnya (pengiriman, deskripsi produk, penipuan), pertimbangkan reserve.", en: "Find the cause (delivery, product description, fraud), consider a reserve." },
  },
  "R-CB-NETWORK-PROX": {
    what: { id: "Rasio Visa VAMP 30 hari mencapai 80% dari batas program Visa.", en: "The 30-day Visa VAMP ratio reached 80% of Visa's program line." },
    why: { id: "Di atas batas, Visa mengenakan denda dan pengawasan. Lebih murah bertindak sekarang.", en: "Over the line Visa fines and monitors. Acting now is cheaper." },
    act: { id: "Pasang reserve, minta toko memperbaiki proses pembatalan atau deskripsi tagihan.", en: "Set a reserve, ask the shop to fix cancellation or its billing descriptor." },
  },
  "R-MC-ECM": {
    what: { id: "Rasio chargeback Mastercard (bulan ini dibanding penjualan bulan lalu) mendekati atau melewati batas program ECM.", en: "The Mastercard chargeback ratio (this month over last month's sales) is near or past the ECM line." },
    why: { id: "Mastercard menghitung berbeda dari Visa; toko bisa aman di Visa tapi bermasalah di Mastercard.", en: "Mastercard counts differently from Visa; a shop can be fine on one and not the other." },
    act: { id: "Sama seperti batas Visa: reserve dan perbaikan penyebab sengketa.", en: "As for the Visa line: a reserve and fixing the cause of disputes." },
  },
  "R-REFUND-RATIO": {
    what: { id: "Refund 30 hari di atas 10% dari transaksi.", en: "30-day refunds above 10% of transactions." },
    why: { id: "Banyak refund sering mendahului banyak chargeback, atau menandakan produk yang tidak sesuai.", en: "Many refunds often come before many chargebacks, or point to a product that disappoints." },
    act: { id: "Periksa ulasan dan kebijakan pengembalian toko.", en: "Check the shop's reviews and return policy." },
  },
  "R-CARD-TESTING": {
    what: { id: "Lebih dari 50 transaksi sangat kecil hari ini dengan lebih dari 40% ditolak.", en: "More than 50 tiny authorisations today with over 40% declined." },
    why: { id: "Penjahat sedang menguji nomor kartu curian lewat toko ini.", en: "Criminals are testing stolen card numbers through this shop." },
    act: { id: "Tahan pencairan dana dan minta toko memasang perlindungan checkout (CAPTCHA, 3-D Secure).", en: "Hold payouts and ask the shop to protect its checkout (CAPTCHA, 3-D Secure)." },
  },
  "R-TICKET-SHIFT": {
    what: { id: "Nilai belanja rata-rata 7 hari lebih dari 2 kali yang dideklarasikan.", en: "The 7-day average order is more than twice the declared one." },
    why: { id: "Toko mungkin menjual barang lain dari yang disetujui, atau sedang dipakai untuk transaksi besar yang tidak wajar.", en: "The shop may be selling something other than what was approved, or be used for unusual large payments." },
    act: { id: "Bandingkan dengan katalog di website; tanyakan ke toko.", en: "Compare with the website's catalogue; ask the shop." },
  },
  "R-XBORDER": {
    what: { id: "Lebih dari separuh transaksi 7 hari memakai kartu luar negeri, padahal toko melayani pasar domestik.", en: "Over half of 7 days' payments use foreign cards for a domestic shop." },
    why: { id: "Kartu luar negeri lebih sering terlibat penipuan, dan bisa menandakan toko dipakai pihak lain.", en: "Foreign cards are more often fraudulent, and it may mean someone else is using the shop." },
    act: { id: "Tanyakan alasannya; periksa negara asal kartu.", en: "Ask why; check the cards' countries." },
  },
  "R-DORMANT-AFTER-SPIKE": {
    what: { id: "Tidak ada transaksi 5 hari atau lebih setelah ada lonjakan volume dalam 14 hari terakhir.", en: "No payments for five days or more after a volume spike in the last 14 days." },
    why: { id: "Pola bust-out: jual besar, lalu diam dan menghilang.", en: "The bust-out pattern: sell big, then go quiet and disappear." },
    act: { id: "Hubungi toko, tahan pencairan bila tidak ada jawaban.", en: "Contact the shop; hold payouts if there is no answer." },
  },
  "R-LIMIT-BREACH": {
    what: { id: "Toko melewati batas volume atau nilai maksimum transaksi yang sudah dipasang.", en: "The shop exceeded a volume or maximum-ticket limit already in place." },
    why: { id: "Batas itu dipasang karena ada risiko; melewatinya berarti risiko bertambah.", en: "The limit was set for a reason; going past it adds risk." },
    act: { id: "Tinjau apakah batas masih tepat atau perlu tindakan lebih keras.", en: "Review whether the limit still fits or a stronger action is needed." },
  },
  "R-WATCHLIST-RESCREEN": {
    what: { id: "Pemeriksaan ulang rutin menemukan pemilik toko cocok dengan daftar sanksi, PEP, atau terminated merchant.", en: "Routine rescreening found an owner matching a sanctions, PEP or terminated-merchant list." },
    why: { id: "Memproses pembayaran untuk pihak terkena sanksi melanggar hukum.", en: "Processing for a sanctioned party is illegal." },
    act: { id: "Compliance memastikan apakah benar orang yang sama; kalau ya, tutup hubungan.", en: "Compliance confirms whether it is the same person; if so, end the relationship." },
  },
  "R-WEBSITE-CHANGE": {
    what: { id: "Pemantauan website mingguan menemukan perubahan: situs mati, kebijakan refund hilang, atau ada produk terlarang.", en: "Weekly website monitoring found a change: the site is down, the refund policy is gone, or restricted products appeared." },
    why: { id: "Toko yang disetujui untuk menjual bunga bisa diam-diam menjual obat keras (transaction laundering). Transaksinya terlihat normal; hanya website-nya yang berubah.", en: "A shop approved to sell flowers can quietly sell prescription drugs (transaction laundering). The payments look normal; only the website changes." },
    act: { id: "Periksa situsnya, minta penjelasan, hentikan bila menjual produk terlarang.", en: "Check the site, ask for an explanation, stop processing if restricted products are sold." },
  },
};

export const CASE_TYPE_EXPLAIN: Record<string, Text> = {
  MONITORING: { id: "Kasus pemantauan: aturan otomatis melihat pola tidak biasa pada transaksi atau website toko.", en: "A monitoring case: an automatic rule saw an unusual pattern in the shop's payments or website." },
  DISPUTE_SPIKE: { id: "Kasus sengketa: chargeback atau laporan penipuan toko ini naik ke tingkat yang berisiko.", en: "A dispute case: this shop's chargebacks or fraud reports reached a risky level." },
  WATCHLIST: { id: "Kasus watchlist: pemilik atau pengendali toko cocok dengan daftar sanksi, PEP, atau terminated merchant.", en: "A watchlist case: an owner or controller matches a sanctions, PEP or terminated-merchant list." },
  UNDERWRITING: { id: "Kasus underwriting: toko baru mendaftar dan perlu dinilai sebelum boleh menerima kartu.", en: "An underwriting case: a new shop applied and must be assessed before it may take cards." },
  RFI_FOLLOWUP: { id: "Kasus tindak lanjut dokumen: toko sudah menjawab permintaan dokumen, atau tenggatnya lewat, dan perlu ditinjau.", en: "A document follow-up case: the shop answered a document request, or its deadline passed, and it needs review." },
  OFFBOARDING: { id: "Kasus penutupan: toko sudah dihentikan; reserve ditahan sampai masa sengketa berakhir, lalu dihitung.", en: "An offboarding case: the shop has been stopped; the reserve is held until the dispute window ends, then reconciled." },
};

export const UI: Record<string, Text> = {
  briefing: { id: "Briefing cerita", en: "Story briefing" },
  whatHappened: { id: "Apa yang terjadi", en: "What happened" },
  whyMatters: { id: "Kenapa ini penting", en: "Why it matters" },
  steps: { id: "Yang perlu dilakukan", en: "What to do" },
  youAre: { id: "Anda sekarang", en: "You are" },
  now: { id: "sekarang", en: "now" },
  doneLabel: { id: "Selesai", en: "Done" },
  outcome: { id: "Hasil akhirnya", en: "The outcome" },
  learn: { id: "Istilah", en: "Term" },
  aboutCase: { id: "Apa kasus ini?", en: "What is this case?" },
  ruleWhat: { id: "Artinya", en: "Means" },
  ruleWhy: { id: "Kenapa penting", en: "Why it matters" },
  ruleAct: { id: "Biasanya dilakukan", en: "Usually" },
  hide: { id: "Sembunyikan", en: "Hide" },
  show: { id: "Tampilkan penjelasan", en: "Show the explanation" },
  waitingFor: { id: "Menunggu", en: "Waiting for" },
  switchTo: { id: "Lanjut sebagai", en: "Continue as" },
};

export const t = (x: Text, lang: Lang) => x[lang];
