'use strict';

const AWS   = require('aws-sdk');
const Slack = require('slack');

/**
 * Handles the http request, calls the bot lambda and responds the request with data
 * @async
 * @param  {Object} data
 * @return {Object}
 */
module.exports.run = async ( data ) => 
{
    const dataObject = JSON.parse( data.body );

    // The response we will return to Slack
    let response = {
        statusCode: 200,
        body      : {},
        // Tell slack we don't want retries, to avoid multiple triggers of this lambda
        headers   : { 'X-Slack-No-Retry': 1 }
    };

    try {
        // If the Slack retry header is present, ignore the call to avoid triggering the lambda multiple times
        if ( !( 'X-Slack-Retry-Num' in data.headers ) )
        {
            switch ( dataObject.type ) 
            {
                case 'url_verification':
                    response.body = verifyCall( dataObject ); 
                    break;
                case 'event_callback':
                    await handleMessage( dataObject.event );
                    response.body = { ok: true }; 
                    break;
                default:
                    response.statusCode = 400,
                    response.body = 'Empty request';
                    break;
            }
        }
    }
    catch( err ) 
    {
        response.statusCode = 500,
        response.body = JSON.stringify( err )
    } 
    finally 
    {
        return response;
    }   
}

/**
 * Verifies the URL with a challenge - https://api.slack.com/events/url_verification
 * @param  {Object} data The event data
 */
function verifyCall( data )
{
    if ( data.token === process.env.VERIFICATION_TOKEN ) 
    {
        return data.challenge;
    }
    else {
        throw 'Verification failed';
    }
}

/**
 * Process the message and executes an action based on the message received
 * @async
 * @param {Object} message The Slack message object
 */
async function handleMessage( message )
{
    // Makes sure the bot was actually mentioned
    if ( !message.bot_id )
    {
        // Gets the command from the message
        let command = parseMessage( message.text );

        // Executes differend commands based in the specified instruction
        switch ( command ) 
        {
            case 'invalidate_cdn':
                const invalidationData = await invalidateDistribution();
                await sendSlackMessage( message.channel, 
                    `Sir/Madam, I've just invalidated the cache, this is the invalidation ID. *${invalidationData.Invalidation.Id}*` );
                break;
            default:
                await sendSlackMessage( message.channel, 
                    `Sir/Madam, I don't understand what you need. Please use \`@${process.env.BOT_NAME} invalidate_cdn\` to clear the CDN cache.` );
                break;
        }
    }
}

/**
 * Sends a message to Slack
 * @param  {String} channel
 * @param  {String} message
 * @return {Promise}
 */
function sendSlackMessage( channel, message )
{
    const params = {
        token  : process.env.BOT_TOKEN,
        channel: channel,
        text   : message

    };

    return Slack.chat.postMessage( params );
}

/**
 * Parses the command/intent from the text of a message received by the bot
 * @param  {String} message
 * @return {String}
 */
function parseMessage( message )
{
    return message.split( ' ', 2 ).pop();
}

/**
 * Creates an invalidation in the configured CloudFront distribution and returns the invalidation ID
 * @return {Promise|String}
 */
function invalidateDistribution()
{
    const CloudFront = new AWS.CloudFront();

    // Invalidation parameters
    const params = {
        DistributionId: process.env.CDN_DISTRIBUTION,
        InvalidationBatch: {
            CallerReference: Date.now() + '',
            Paths: { 
                Quantity: '1',
                Items: [
                    '/*'
                ]
            }
        }
    };

    return new Promise( ( resolve, reject ) => 
    {
        // Call the CloudFront wrapper to invalidate the CDN cache
        CloudFront.createInvalidation( params, ( err, data ) => 
        {
            if ( err ) reject( err );
            else       resolve( data );
        } );
    } );
}

