module.exports = {
  async selectMenuResponse(interaction) {
    const selectMenu = interaction.client.selectMenus.get(interaction.customId);
    if (!selectMenu) return;
    
    console.log(
      `${interaction?.user?.tag} in guild ${interaction?.guild?.name}, channel #${interaction?.channel?.name} triggered selectMenu ${interaction?.customId}`
    );
    try {
      await selectMenu.sendResponse(interaction);
    } catch (error) { 
      console.log("ERROR: in selectMenuResponse")
      console.error(error)
    }
  },
};
