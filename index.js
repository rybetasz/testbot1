require("dotenv").config();
const { Client, GatewayIntentBits } = require("discord.js");
const {
  joinVoiceChannel,
  createAudioPlayer,
  createAudioResource,
  AudioPlayerStatus,
  StreamType,
} = require("@discordjs/voice");
const { Innertube } = require("youtubei.js");
const { spawn } = require("child_process");

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildVoiceStates,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
});

const prefix = "!";

let youtube;
const queues = new Map();

/* ---------------- INIT ---------------- */

client.once("ready", async () => {
  console.log(`${client.user.tag} hazır`);
  youtube = await Innertube.create();
});

/* ---------------- QUEUE ---------------- */

function getQueue(guildId) {
  if (!queues.has(guildId)) {
    queues.set(guildId, {
      songs: [],
      player: createAudioPlayer(),
      connection: null,
      playing: false,
    });
  }
  return queues.get(guildId);
}

/* ---------------- STREAM (FIXED AUDIO PIPE) ---------------- */

function createStream(url) {
  const yt = spawn("yt-dlp", ["-f", "bestaudio", "-o", "-", url]);

  const ffmpeg = spawn("ffmpeg", [
    "-i",
    "pipe:0",
    "-f",
    "opus",
    "-ar",
    "48000",
    "-ac",
    "2",
    "pipe:1",
  ]);

  yt.stdout.pipe(ffmpeg.stdin);

  return ffmpeg;
}

/* ---------------- PLAY NEXT ---------------- */

async function playNext(guildId) {
  const queue = getQueue(guildId);

  if (!queue.songs.length) {
    queue.playing = false;
    return;
  }

  const song = queue.songs[0];

  const stream = createStream(song.url);

  const resource = createAudioResource(stream.stdout, {
    inputType: StreamType.Opus,
  });

  queue.player.play(resource);
  queue.playing = true;
}

/* ---------------- EVENTS ---------------- */

client.on("messageCreate", async (message) => {
  if (!message.guild || message.author.bot) return;
  if (!message.content.startsWith(prefix)) return;

  const args = message.content.slice(prefix.length).trim().split(/ +/);
  const cmd = args.shift().toLowerCase();

  const queue = getQueue(message.guild.id);

  /* -------- PLAY -------- */
  if (cmd === "play") {
    const voice = message.member.voice.channel;
    if (!voice) return message.reply("Voice’a gir");

    const query = args.join(" ");
    if (!query) return message.reply("Şarkı yaz");

    let video;

    if (query.includes("youtube.com") || query.includes("youtu.be")) {
      video = { title: "YouTube Link", url: query };
    } else {
      const search = await youtube.search(query);
      video = {
        title: search.videos[0].title,
        url: search.videos[0].url,
      };
    }

    if (!queue.connection) {
      queue.connection = joinVoiceChannel({
        channelId: voice.id,
        guildId: message.guild.id,
        adapterCreator: message.guild.voiceAdapterCreator,
      });

      queue.connection.subscribe(queue.player);

      queue.player.on(AudioPlayerStatus.Idle, () => {
        queue.songs.shift();
        playNext(message.guild.id);
      });

      queue.player.on("error", (e) => {
        console.log("PLAYER ERROR:", e);
      });
    }

    queue.songs.push(video);

    message.reply(`➕ Eklendi: **${video.title}**`);

    if (!queue.playing) playNext(message.guild.id);
  }

  /* -------- SKIP -------- */
  if (cmd === "skip") {
    queue.player.stop();
    message.reply("⏭ Skip");
  }

  /* -------- STOP -------- */
  if (cmd === "stop") {
    queue.songs = [];
    if (queue.connection) queue.connection.destroy();
    queues.delete(message.guild.id);
    message.reply("⛔ Durdu");
  }

  /* -------- QUEUE -------- */
  if (cmd === "queue") {
    if (!queue.songs.length) return message.reply("Boş");

    message.reply(
      queue.songs.map((s, i) => `${i + 1}. ${s.title}`).join("\n")
    );
  }
});

client.login(process.env.TOKEN);
