const computeCharacters = require("../util/computeCharacters");
jest.mock("../werewolf_db", () => {
  return {
    findSettings: () => ({ extra_characters: true, allow_vampires: true, random_cards: false }),
  };
});

test("computing characters", async () => {
  const amountOfPlayers = 12;
  const characterCards = await computeCharacters(amountOfPlayers, 1);

  cardCount = {};
  characterCards.forEach((card) => {
    if (cardCount[card]) {
      cardCount[card] += 1;
    } else {
      cardCount[card] = 1;
    }
  });

  console.log(cardCount);

  if (cardCount["baker"]) {
    expect(cardCount["baker"]).toBeLessThanOrEqual(1)
  }
  if (cardCount["witch"]) {
    expect(cardCount["witch"]).toBeLessThanOrEqual(1)
  }
  if (cardCount["king"]) {
    expect(cardCount["king"]).toBeLessThanOrEqual(1)
  }
  expect(characterCards.length).toBe(amountOfPlayers)
});
