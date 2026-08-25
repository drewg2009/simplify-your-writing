"use strict";

const { test, expect } = require("@playwright/test");
const path = require("path");

const INDEX_URL = "file://" + path.resolve(__dirname, "..", "..", "index.html");

const COPY = `You probably missed this subtle change: We added topic badges to the top of stories. We know this specific tweak increased the number of stories users read on Medium, and also caused readers to follow more topics, which is important—more on that below.

Making topic badges more visible goes hand in hand with some other design improvements we made recently, like making it clearer when you do or don't follow a topic.


Ultimately, we want readers to have more information about what they're reading, along with more control over what stories they discover on Medium.


Reads are hard to get
How can adding topic badges to the top of stories make readers more likely to read stories?


Become a Medium member
While we know topics help readers find great stories, our theory is that moving the topic badges up lets them act as mini summaries for that story. Writers can add up to five topics to their stories that help Medium recommend that story to the readers most likely to be interested in it. By moving those topics to the top of the story, readers get a sneak preview of what the story is about, beyond the title, subtitle, and header image.


If you're a reader who noticed yourself reading more thanks to this change, please share why in the responses!


Helping users read great Medium stories is our business model, but it's also why we come to work every day. I believe that a good story can change your life. Good stories have already changed my life, in big and small ways – influencing what knives I buy, how I handled accounting when I was running my freelancing business, or just making me feel less alone and giving me a laugh on my parenting journey. That's only possible if those stories find you—or you find them.


Historically, one of our biggest challenges has been to shift the needle globally on getting people to read more at Medium. There are many factors out of our control, too, so it's hard to know exactly what change had what effect. We're constantly improving recommendations, driving more writers to come to Medium, and meanwhile the overall online landscape shifts. Reads go up and down seasonally, and sometimes independently of what we're trying.


But with the small design change of moving topic badges to the top of stories, we see that users are reading more on Medium. That means more readers are finding meaningful, valuable, and, yes, life-changing stories on Medium.


Control your content
Another advantage to adding topic badges to the top of stories is that more readers have been following (or muting) topics. This gives readers more control over what they'll see in their feeds—the more topics you follow or mute, the better your recommendations will be. And better recommendations leads to more reads.


On Medium, writers publish thousands of stories every day. How can Medium sort through them to make sure you see the best of the best? Our curation team sorts through thousands of stories per day to find ones that meet our Boost criteria. Publication editors accept or reject stories for the publications you follow. And we have a machine learning algorithm to help recommend stories based on your reading history, and what other readers with similar interests are enjoying. Making topics more visible makes those recommendations that much better.


It's critical to strengthen that last branch: the ability for readers to control what they see directly. That's why we want to make topics more visible. The more you follow and mute, the better your recommendations will be.`;

test("hovering a highlighted phrase shows its suggestion box after scrolling", async ({ page }) => {
  await page.goto(INDEX_URL);
  await page.fill("#input", COPY);
  await expect(page.locator("#mirror mark")).not.toHaveCount(0);

  const mark = page.locator("#mirror mark", { hasText: "There are many" });
  await expect(mark).toBeVisible();
  await mark.scrollIntoViewIfNeeded();

  const box = await mark.boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);

  await expect(page.locator(".suggest-box.visible", { hasText: "there are many" })).toBeVisible();
});