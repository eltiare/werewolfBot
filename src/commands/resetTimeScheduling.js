const { SlashCommandBuilder } = require("@discordjs/builders");
const { commandNames } = require("../util/commandHelpers");
const { timeScheduling } = require("../util/timeHelper");

module.exports = {
  data: new SlashCommandBuilder()
    .setName(commandNames.RESET_SCHEDULING)
    .setDescription("Reset the time schedulers for day and nigh time"),
  async execute(interaction) {
    const ok = await timeScheduling(interaction, "8", "20");
    if (!ok) {
      return
    }
    await interaction.reply({
      content: "time scheduling reset",
      ephemeral: true,
    });
  },
};
