import streamlit as st
from sentence_transformers import SentenceTransformer
import json
from tqdm import tqdm
from pathlib import Path
from policyengine_core.parameters import Parameter, get_parameter
from policyengine_core.reforms import set_parameter
from policyengine_uk.system import system as uk_system
from policyengine_us.system import system as us_system
from policyengine_uk import Simulation as UKSimulation
from policyengine_us import Simulation as USSimulation

UKSimulation.default_input_period = 2023
USSimulation.default_input_period = 2023
import openai
import os
from typing import Iterable, Tuple
import requests
import time

openai.api_key = os.environ["OPENAI_API_KEY"]

model = SentenceTransformer("all-mpnet-base-v2")
st.title("PolicyEngine Chat")

# Select country (UK or US)

country_id = st.selectbox(
    "Country",
    ["UK", "US"],
).lower()

system = {
    "uk": uk_system,
    "us": us_system,
}[country_id]

# Textbox for user input

user_input = st.text_area("User input")


def get_embeddings(country_id: str) -> Tuple[dict, dict]:
    variable_embeddings = {}  # variable_name -> embedding
    variable_embeddings_path = Path(f"variable_embeddings_{country_id}.json")

    VARIABLE_FILTERS = {
        "uk": [
            "age",
            "employment_income",
            "universal_credit",
            "household_net_income",
            "household_benefits",
            "income_tax",
            "national_insurance",
        ],
        "us": [
            "age",
            "employment_income",
            "snap",
            "household_net_income",
            "income_tax",
            "household_benefits",
            "household_tax",
        ],
    }

    if variable_embeddings_path.exists():
        with open(variable_embeddings_path) as f:
            variable_embeddings = json.load(f)
    else:
        variables = system.variables
        variable_json_data = {
            variable.name: json.dumps(
                {
                    "label": variable.label,
                    "name": variable.name,
                    "documentation": variable.documentation,
                }
            )
            for variable in variables.values()
            if variable.name in VARIABLE_FILTERS[country_id]
        }

        variable_embeddings = model.encode(list(variable_json_data.values()))
        # convert from numpy to list
        variable_embeddings = [
            [float(x) for x in embedding] for embedding in variable_embeddings
        ]
        variable_names = list(variable_json_data.keys())
        variable_embeddings = {
            variable_names[i]: variable_embeddings[i]
            for i in range(len(variable_names))
        }

        with open(variable_embeddings_path, "w") as f:
            json.dump(variable_embeddings, f)

    # Same for parameters

    parameter_embeddings = {}  # parameter_name -> embedding

    parameter_embeddings_path = Path(f"parameter_embeddings_{country_id}.json")

    if parameter_embeddings_path.exists():
        with open(parameter_embeddings_path) as f:
            parameter_embeddings = json.load(f)
    else:
        parameters = system.parameters
        parameter_json_data = {
            parameter.name: json.dumps(
                {
                    "label": parameter.metadata.get("label"),
                    "description": parameter.description,
                    "name": parameter.name,
                }
            )
            for parameter in parameters.gov.get_descendants()
            if isinstance(parameter, Parameter)
        }

        parameter_embeddings = model.encode(list(parameter_json_data.values()))
        # convert from numpy to list
        parameter_embeddings = [
            [float(x) for x in embedding] for embedding in parameter_embeddings
        ]
        parameter_names = list(parameter_json_data.keys())
        parameter_embeddings = {
            parameter_names[i]: parameter_embeddings[i]
            for i in range(len(parameter_names))
        }

        with open(parameter_embeddings_path, "w") as f:
            json.dump(parameter_embeddings, f)

    return variable_embeddings, parameter_embeddings


variable_embeddings, parameter_embeddings = get_embeddings(country_id)


def ask_gpt(prompt: str, model: str = "gpt-4") -> str:
    """Return the response to a prompt from the OpenAI API.

    Args:
        prompt (str): The prompt to send to the API.
        model (str, optional): The model to use. Defaults to "gpt-4".

    Returns:
        str: The response from the API.
    """
    return openai.ChatCompletion.create(
        model=model,
        messages=[
            dict(
                role="user",
                content=prompt,
            )
        ],
    )["choices"][0]["message"]["content"]


def ask_gpt_stream(
    prompt: str = None, model: str = "gpt-4", conversation: dict = None
) -> Iterable:
    """Return the response to a prompt from the OpenAI API, yielding the results as they come in.

    Args:
        prompt (str): The prompt to send to the API.
        model (str, optional): The model to use. Defaults to "gpt-4".

    Returns:
        Iterable: The response from the API.
    """
    if prompt:
        payload = [
            dict(
                role="user",
                content=prompt,
            )
        ]
    elif conversation:
        payload = conversation
    response = openai.ChatCompletion.create(
        model=model,
        messages=payload,
        stream=True,
    )

    combined_response = ""

    for result in response:
        combined_response += (
            result["choices"][0].get("delta", {}).get("content", "")
        )
        yield combined_response


def identify_category(user_input: str) -> str:
    """Identify the category of a user input.

    Args:
        user_input (str): The user input.

    Returns:
        str: The category of the user input.
    """
    PROMPT = f"""

    You are a chatbot for PolicyEngine, a tool for computing the impact of taxes and benefits on households and the economy. Users might give you requests, and you should use the PolicyEngine API to respond to them. I will give you the user request and should identify whether it is:
    A: computing household properties
    B: computing household properties under a policy change
    C: computing the impact of a policy change on the economy
    D: something else
    Respond only with the letter of the correct answer. If you are unsure, respond with D.

    User request: {user_input}
    """
    return ask_gpt(PROMPT)


def get_relevant_variables(prompt: str) -> Iterable:
    from sklearn.metrics.pairwise import cosine_similarity
    import numpy as np

    user_input_embedding = model.encode([prompt])[0]
    user_input_embedding = np.array(user_input_embedding).reshape(1, -1)
    variable_embeddings_array = np.array(list(variable_embeddings.values()))
    similarities = cosine_similarity(
        user_input_embedding, variable_embeddings_array
    )[0]
    most_similar_variable_indices = np.argsort(similarities)[::-1][:5]
    most_similar_variable_names = [
        list(variable_embeddings.keys())[i]
        for i in most_similar_variable_indices
    ]
    # Get the full variable objects
    most_similar_variables = [
        system.variables[variable_name]
        for variable_name in most_similar_variable_names
    ]
    variable_jsons = [
        json.dumps(
            {
                "label": variable.label,
                "name": variable.name,
                "documentation": variable.documentation,
                "entity": variable.entity.key,
            }
        )
        for variable in most_similar_variables
    ]
    return variable_jsons


def get_relevant_parameters(prompt: str) -> Iterable:
    from sklearn.metrics.pairwise import cosine_similarity
    import numpy as np

    user_input_embedding = model.encode([prompt])[0]
    user_input_embedding = np.array(user_input_embedding).reshape(1, -1)
    parameter_embeddings_array = np.array(list(parameter_embeddings.values()))
    similarities = cosine_similarity(
        user_input_embedding, parameter_embeddings_array
    )[0]
    most_similar_parameter_indices = np.argsort(similarities)[::-1][:5]
    most_similar_parameter_names = [
        list(parameter_embeddings.keys())[i]
        for i in most_similar_parameter_indices
    ]
    # Get the full variable objects
    most_similar_parameters = [
        get_parameter(system.parameters, parameter_name)
        for parameter_name in most_similar_parameter_names
    ]
    parameter_jsons = [
        json.dumps(
            {
                "label": parameter.metadata.get("label"),
                "name": parameter.name,
                "documentation": parameter.metadata.get("description"),
                "values": str(parameter),
            }
        )
        for parameter in most_similar_parameters
    ]
    return parameter_jsons


def build_household(prompt: str) -> dict:
    UK_EXAMPLE = {
        "people": {
            "person_1": {
                "employment_income": 30_000,
            },
            "child_1": {
                "age": 10,
            },
        },
    }

    US_EXAMPLE = {
        "people": {
            "person_1": {
                "employment_income": 30_000,
            },
            "child_1": {
                "age": 10,
            },
        },
    }

    variable_jsons = get_relevant_variables(prompt)

    HOUSEHOLD_PROMPT = f"""
    You need to specify the OpenFisca-style JSON description of a household described by a user. Here's the format for a parent of one child:
    {json.dumps(
        {"uk": UK_EXAMPLE, "us": US_EXAMPLE}[country_id],
        indent=4
    )}
    Assume for the above example that age and employment income was provided, and do not add any assumed variables unless they've been explicitly provided. I will give you the metadata of any relevant variables for the household. Add variables to the appropriate entity according to the 'entity' key in their metadata.
    Respond only with the JSON description of the household. 
    
    If you are unsure, respond with an empty JSON object.
    User request: {user_input}
    Most similar variables:
    {variable_jsons}
    """

    household = json.loads(ask_gpt(HOUSEHOLD_PROMPT))
    return household


def get_target_variable(prompt: str) -> dict:
    """Calculate a household property.

    Args:
        user_prompt (str): The user prompt.

    Returns:
        dict: The result of the calculation.
    """

    relevant_variables = get_relevant_variables(prompt)
    PROMPT = f"""
    You are a chatbot for PolicyEngine, a tool for computing the impact of taxes and benefits on households and the economy. I've obtained a household description from the user, and can calculate a specific property, but I need you to tell me the variable name in the model to calculate. I will give you the user request and relevant variable name metadata, and you should respond with the variable name to calculate. If you are unsure, respond with an empty string.

    User request: {user_input}
    Possible variable names: {relevant_variables}
    """
    return ask_gpt(PROMPT)


def calculate_variable(
    country_id: str, household: dict, variable_name: str, reform: dict
) -> list:
    if reform is not None:
        reform = tuple(
            [
                set_parameter(
                    parameter, reform[parameter], period="year:2023:10"
                )
                for parameter in reform
            ]
        )
    simulation = {
        "uk": UKSimulation,
        "us": USSimulation,
    }[country_id](
        situation=household,
        reform=reform,
    )
    simulation.trace = True
    variable = simulation.tax_benefit_system.variables[variable_name]
    result = simulation.calculate(variable_name, 2023).tolist()
    computation_tree = "\n".join(
        simulation.tracer.computation_log.lines(False, 3)
    )
    simulation.tracer.print_computation_log(max_depth=5)
    return {
        "result": result,
        "variable_metadata": {
            "name": variable.name,
            "label": variable.label,
            "documentation": variable.documentation,
            "entity": variable.entity.key,
            "unit": variable.unit,
            "definition_period": variable.definition_period,
        },
        "computation_tree": computation_tree,
    }


def give_complete_answer(steps: dict) -> str:
    PROMPT = f"""
    You are a chatbot for PolicyEngine, a tool for computing the impact of taxes and benefits on households and the economy. You've just carried out a series of steps to answer a user's question, and now you need to give them the answer. 
    
    IMPORTANT: respond first with the shortest sentence that answers their question only in a single concise sentence.
    
    You can give a few more details afterwards if they're relevant for understanding the answer, like a table showing the workings-out. Use Markdown formatting to embolden and make it look nice, and e.g. shorten large numbers to e.g. bn. At the end, give a disclaimer that the results were computed with PolicyEngine, a simulation tool and that the users should check with tax or benefit advisors before making financial decisions based on them.
    
    Steps: {steps}
    """
    yield from ask_gpt_stream(PROMPT)


def ask_policyengine(prompt: str) -> Tuple[str, dict]:
    """Ask PolicyEngine a question.

    Args:
        prompt (str): The prompt to send to PolicyEngine.

    Returns:
        Tuple[str, dict]: The response from PolicyEngine, and the workings-out.
    """
    output_category = identify_category(prompt)
    output_category_step = {
        "A": "computing household properties under current law",
        "B": "computing household properties under a policy change",
        "C": "computing the impact of a policy change on the economy",
        "D": "unknown",
    }[output_category]

    if output_category in ["A", "B"]:
        # We need to specify the household.
        household = build_household(prompt)
        if output_category == "B":
            reform = build_reform(prompt)
        else:
            reform = None
        target_variable = get_target_variable(prompt)
        simulation_result = calculate_variable(
            country_id, household, target_variable, reform
        )
        if output_category == "B":
            reform = build_reform(prompt)
        else:
            reform = None
        complete_answer = give_complete_answer(
            {
                "output_category": output_category_step,
                "household": household,
                "target_variable": target_variable,
                "simulation_result": simulation_result,
                "reform": reform,
                "user_question": prompt,
            }
        )
        return complete_answer, {
            "output_category": output_category_step,
            "household": household,
            "target_variable": target_variable,
            "simulation_result": simulation_result,
            "reform": reform,
            "user_question": prompt,
        }
    elif output_category == "C":
        reform = build_reform(prompt)
        economic_impacts = get_economic_impact(reform)
        complete_answer = give_complete_answer(
            {
                "output_category": output_category_step,
                "reform": reform,
                "model_economic_impacts": economic_impacts,
                "user_question": prompt,
            }
        )
        return complete_answer, {
            "output_category": output_category_step,
            "reform": reform,
            "model_economic_impacts": economic_impacts,
            "user_question": prompt,
        }


def build_reform(prompt: str) -> dict:
    EXAMPLE_REFORM = {
        "gov.hmrc.income_tax.allowances.personal_allowance": 0,
    }
    PROMPT = f"""
    You are a chatbot for PolicyEngine, a tool for computing the impact of taxes and benefits on households and the economy. The user has given you a question involving how a policy reform would affect people and you need to build the JSON reform object to pass to PolicyEngine to answer it. Here's an example policy reform that removes the personal allowance for income tax: {json.dumps(EXAMPLE_REFORM, indent=4)}. I will give you the user request, some possible reform metadata and you should respond with the reform object. If you are unsure, respond with an empty JSON object.

    User request: {user_input}
    Relevant parameters: {get_relevant_parameters(prompt)}
    """
    return json.loads(ask_gpt(PROMPT))


def get_economic_impact(reform: dict) -> dict:
    api_reform = {
        parameter: {"2023-01-01.2025-01-01": value}
        for parameter, value in reform.items()
    }
    # Send a POST request to api.policyengine.org/{country_id}/policy with { data: api_reform } and get the policy id from the JSON { result: { policy_id: x } }
    response = requests.post(
        f"https://api.policyengine.org/{country_id}/policy",
        json={
            "data": api_reform,
        },
    )
    policy_id = response.json()["result"]["policy_id"]
    baseline = 1 if country_id == "uk" else 2
    # Send a GET request to api.policyengine.org/{country_id}/economy/{policy_id}/over/{baseline} and get the result from the JSON { status: [status], result: [result] }. If status is "computing", wait 5 seconds and try again.
    status = "computing"
    while status == "computing":
        response = requests.get(
            f"https://api.policyengine.org/{country_id}/economy/{policy_id}/over/{baseline}",
        )
        status = response.json()["status"]
        if status == "computing":
            time.sleep(5)
    result = response.json()["result"]
    return result


submit = st.button("Submit")
if submit:
    complete_answer, steps = ask_policyengine(user_input)
    placeholder = st.empty()
    for result in complete_answer:
        placeholder.write(result.replace("$", "\$"))
    with st.expander("Show steps"):
        st.json(steps)
