const { SlashCommandBuilder } = require("@discordjs/builders");
const _ = require("lodash");
const { commandNames } = require("../util/commandHelpers");
const { characters } = require("../util/characterHelpers/characterUtil")
const { findUsersWithIds, findSettings } = require("../werewolf_db");
const { getPlayingCount } = require("../util/userHelpers");
const { permissionCheck } = require("../util/permissionCheck");
const { getAliveUsersIds } = require("../util/discordHelpers");

module.exports = {
  data: new SlashCommandBuilder()
    .setName(commandNames.WHO_IS_ALIVE)
    .setDescription(
      "Shows which players are alive in the game and number of villagers and werewolves"
    ),
  async execute(interaction) {
    const deniedMessage = await permissionCheck({
      interaction,
      guildOnly: true,
    });

    if (deniedMessage) {
      await interaction.reply({
        content: deniedMessage,
        ephemeral: true,
      });
      return;
    }

    const aliveUsersId = await getAliveUsersIds(interaction);
    const members = await interaction.guild.members.fetch();

    const cursor = await findUsersWithIds(interaction.guild.id, aliveUsersId);
    const dbUsers = await cursor.toArray();
    const settings = await findSettings(interaction.guild.id);

    message = "Players Alive:\n";
    werewolfCount = 0;
    villagerCount = 0;
    vampireCount = 0;

    _.shuffle(dbUsers).forEach((user) => {
      message += `${members.get(user.user_id)}\n`;
      if (user.character === characters.WEREWOLF) {
        werewolfCount += 1;
      } else if (user.is_vampire) {
        vampireCount += 1;
      } else {
        villagerCount += 1;
      }
    });

    if (_.isEmpty(dbUsers)) {
      const {playersCount, playingMembers} = await getPlayingCount(interaction)
      await interaction.reply({
        content: `Player count: ${playersCount}\n${_.join(playingMembers, "\n")}`,
        ephemeral: false,
        allowedMentions: {
          parse: []
        }
      });
      return;
    }

    const vampireMessage = vampireCount
      ? `Vampire Count: ${vampireCount}\n`
      : "";
    
    if (!settings.hard_mode) {
      message += `Werewolf Count: ${werewolfCount}\n${vampireMessage}Villager Count: ${villagerCount}`;
    }

    await interaction.reply({
      content: message,
      ephemeral: false,
      allowedMentions: {
        parse: []
      }
    });
  },
};
