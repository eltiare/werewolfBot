const { SlashCommandBuilder } = require("@discordjs/builders");
const _ = require("lodash");
const { commandNames, characters } = require("../util/commandHelpers");
const { findUsersWithIds } = require("../werewolf_db");
const { getAliveUsersIds } = require("../util/userHelpers");

module.exports = {
  data: new SlashCommandBuilder()
    .setName(commandNames.WHO_IS_ALIVE)
    .setDescription(
      "Shows witch players are alive in the game and number of villagers and werewolves"
    ),
  async execute(interaction) {
    await interaction.deferReply({
      ephemeral: false,
    });
    const aliveUsersId = await getAliveUsersIds(interaction);

    const cursor = await findUsersWithIds(interaction.guild.id, aliveUsersId);
    const dbUsers = await cursor.toArray();

    message = "Players Alive:\n";
    werewolfCount = 0;
    villagerCount = 0;

    _.shuffle(dbUsers).forEach((user) => {
      message += user.nickname
        ? `**${user.nickname}**\n`
        : `**${user.name}**\n`;
      if (user.character === characters.WEREWOLF) {
        werewolfCount += 1;
      } else {
        villagerCount += 1;
      }
    });

    if (_.isEmpty(dbUsers)) {
      await interaction.editReply({
        content:
          "No one is alive sorry...\nhttps://tenor.com/view/status-tired-dead-haggard-gif-11733031",
        ephemeral: false,
      });
      return;
    }

    message += `Werewolf Count: ${werewolfCount}\nVillager Count: ${villagerCount}`;

    await interaction.editReply({
      content: message,
      ephemeral: false,
    });
  },
};
