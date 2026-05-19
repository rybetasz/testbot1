const { Client, GatewayIntentBits } = require("discord.js");
const {
  joinVoiceChannel,
  createAudioPlayer,
  createAudioResource,
  AudioPlayerStatus,
  NoSubscriberBehavior,
} = require("@discordjs/voice");

const ytdl = require("ytdl-core");

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildVoiceStates,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
});

const prefix = "!";
const queues = new Map();

client.on("ready", () => {
  console.log(`${client.user.tag} hazýr`);
});

// ================== PLAY ==================
async function playSong(guild, connection) {
  const serverQueue = queues.get(guild.id);
  if (!serverQueue) return;

  if (serverQueue.songs.length === 0) {
    connection.destroy();
    queues.delete(guild.id);
    return;
  }

  const song = serverQueue.songs[0];

  const stream = ytdl(song.url, {
    filter: "audioonly",
    quality: "highestaudio",
  });

  const resource = createAudioResource(stream);

  serverQueue.player.play(resource);
}

// ================== MESSAGE ==================
client.on("messageCreate", async (message) => {
  if (!message.guild || message.author.bot) return;

  const args = message.content.split(" ");
  const cmd = args.shift().toLowerCase();

  // ================== PLAY ==================
  if (cmd === `${prefix}play`) {
    const voiceChannel = message.member.voice.channel;
    if (!voiceChannel) return message.reply("Önce voice’a gir.");

    const url = args[0];
    if (!ytdl.validateURL(url)) return message.reply("Geçerli YouTube linki ver.");

    let serverQueue = queues.get(message.guild.id);

    if (!serverQueue) {
      const player = createAudioPlayer({
        behaviors: {
          noSubscriber: NoSubscriberBehavior.Play,
        },
      });

      const connection = joinVoiceChannel({
        channelId: voiceChannel.id,
        guildId: message.guild.id,
        adapterCreator: message.guild.voiceAdapterCreator,
      });

      serverQueue = {
        connection,
        player,
        songs: [],
      };

      queues.set(message.guild.id, serverQueue);

      connection.subscribe(player);

      player.on(AudioPlayerStatus.Idle, () => {
        serverQueue.songs.shift();
        playSong(message.guild, connection);
      });
    }

    serverQueue.songs.push({ url });
    message.channel.send(`?? Kuyruða eklendi: ${url}`);

    if (serverQueue.songs.length === 1) {
      playSong(message.guild, serverQueue.connection);
    }
  }

  // ================== SKIP ==================
  if (cmd === `${prefix}skip`) {
    const serverQueue = queues.get(message.guild.id);
    if (!serverQueue) return message.reply("Queue boþ.");

    serverQueue.player.stop(); // direkt next song tetikler
    message.channel.send("? Þarký atlandý.");
  }

  // ================== QUEUE ==================
  if (cmd === `${prefix}queue`) {
    const serverQueue = queues.get(message.guild.id);
    if (!serverQueue) return message.reply("Queue boþ.");

    message.channel.send(
      "?? Queue:\n" +
        serverQueue.songs.map((s, i) => `${i + 1}. ${s.url}`).join("\n")
    );
  }
});
require('dotenv').config();
client.login(process.env.TOKEN);
