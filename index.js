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

// guild queue sistemi
const queues = new Map();

client.once("ready", async () => {
  console.log("Bot hazır");
  youtube = await Innertube.create();
});

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

// yt-dlp stream
function createStream(url) {
  return spawn("yt-dlp", ["-f", "bestaudio", "-o", "-", url], {
    stdio: ["ignore", "pipe", "ignore"],
  });
}

async function playNext(guildId) {
  const queue = getQueue(guildId);

  if (queue.songs.length === 0) {
    queue.playing = false;
    return;
  }

  const song = queue.songs[0];

  const stream = createStream(song.url);

  const resource = createAudioResource(stream.stdout, {
    inputType: StreamType.Arbitrary,
  });

  queue.player.play(resource);
  queue.playing = true;
}

client.on("messageCreate", async (message) => {
  if (!message.guild || message.author.bot) return;
  if (!message.content.startsWith(prefix)) return;

  const args = message.content.slice(prefix.length).trim().split(/ +/);
  const cmd = args.shift().toLowerCase();

  const queue = getQueue(message.guild.id);

  // PLAY
  if (cmd === "play") {
    const voice = message.member.voice.channel;
    if (!voice) return message.reply("Voice’a gir");

    const query = args.join(" ");
    if (!query) return message.reply("Şarkı yaz");

    let video;

    // link mi search mü?
    if (query.includes("youtube.com") || query.includes("youtu.be")) {
      video = { title: "YouTube Link", url: query };
    } else {
      const search = await youtube.search(query);
      video = {
        title: search.videos[0].title,
        url: search.videos[0].url,
      };
    }

    // connection
    if (!queue.connection) {
      queue.connection = joinVoiceChannel({
        channelId: voice.id,
        guildId: message.guild.id,
        adapterCreator: message.guild.voiceAdapterCreator,
      });

      queue.connection.subscribe(queue.player);

      // autoplay logic
      queue.player.on(AudioPlayerStatus.Idle, () => {
        queue.songs.shift();
        playNext(message.guild.id);
      });
    }

    queue.songs.push(video);

    message.reply(`➕ Eklendi: **${video.title}**`);

    if (!queue.playing) {
      playNext(message.guild.id);
    }
  }

  // SKIP
  if (cmd === "skip") {
    if (queue.player) {
      queue.player.stop();
      message.reply("⏭ Skip");
    }
  }

  // STOP
  if (cmd === "stop") {
    queue.songs = [];
    if (queue.connection) queue.connection.destroy();
    queues.delete(message.guild.id);
    message.reply("⛔ Durduruldu");
  }

  // QUEUE
  if (cmd === "queue") {
    if (!queue.songs.length) return message.reply("Boş queue");

    message.reply(
      queue.songs.map((s, i) => `${i + 1}. ${s.title}`).join("\n")
    );
  }
});

client.login(process.env.TOKEN);
